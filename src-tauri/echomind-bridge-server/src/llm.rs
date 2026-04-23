use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct LlmConfig {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatOutcome {
    pub content: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    /// Cost estimate in USD-cents (rounded up).
    pub cost_cents: i64,
}

/// Very rough per-1k-token pricing in USD. Unknown models default to a conservative fallback.
fn price_per_1k_usd(provider: &str, model: &str) -> (f64, f64) {
    let m = model.to_lowercase();
    match provider {
        "openai" => {
            if m.starts_with("gpt-4o-mini") { (0.00015, 0.00060) }
            else if m.starts_with("gpt-4o") { (0.0025, 0.01) }
            else if m.starts_with("gpt-4") { (0.03, 0.06) }
            else if m.starts_with("o1") { (0.015, 0.06) }
            else if m.starts_with("o3") || m.starts_with("o4") { (0.002, 0.008) }
            else { (0.001, 0.003) }
        }
        "claude" => {
            if m.contains("opus") { (0.015, 0.075) }
            else if m.contains("haiku") { (0.0008, 0.004) }
            else { (0.003, 0.015) } // sonnet default
        }
        "gemini" => {
            if m.contains("flash") { (0.000075, 0.0003) }
            else { (0.00125, 0.005) }
        }
        _ => (0.005, 0.015),
    }
}

fn cents_from_tokens(provider: &str, model: &str, prompt: u32, completion: u32) -> i64 {
    let (in_price, out_price) = price_per_1k_usd(provider, model);
    let usd = (prompt as f64) * in_price / 1000.0 + (completion as f64) * out_price / 1000.0;
    (usd * 100.0).ceil() as i64
}

pub async fn call_chat(cfg: &LlmConfig, messages: &[ChatMsg]) -> Result<ChatOutcome, AppError> {
    match cfg.provider.as_str() {
        "openai" => call_openai(cfg, messages).await,
        "claude" => call_claude(cfg, messages).await,
        "gemini" => call_gemini(cfg, messages).await,
        other => Err(AppError::BadRequest(format!("unknown provider: {other}"))),
    }
}

async fn call_openai(cfg: &LlmConfig, messages: &[ChatMsg]) -> Result<ChatOutcome, AppError> {
    let base = cfg.base_url.as_deref().unwrap_or("https://api.openai.com/v1");
    let msgs: Vec<Value> = messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect();
    let body = json!({ "model": cfg.model, "messages": msgs });

    let resp = reqwest::Client::new()
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("openai: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Upstream(format!("openai {status}: {text}")));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| AppError::Upstream(e.to_string()))?;
    let content = v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
    let prompt = v["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32;
    let completion = v["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32;
    Ok(ChatOutcome {
        content,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cost_cents: cents_from_tokens("openai", &cfg.model, prompt, completion),
    })
}

async fn call_claude(cfg: &LlmConfig, messages: &[ChatMsg]) -> Result<ChatOutcome, AppError> {
    let base = cfg.base_url.as_deref().unwrap_or("https://api.anthropic.com");
    // Split system from messages.
    let mut system_parts: Vec<String> = Vec::new();
    let mut conv: Vec<Value> = Vec::new();
    for m in messages {
        if m.role == "system" {
            system_parts.push(m.content.clone());
        } else {
            conv.push(json!({"role": m.role, "content": m.content}));
        }
    }
    let mut body = json!({
        "model": cfg.model,
        "max_tokens": 2048,
        "messages": conv,
    });
    if !system_parts.is_empty() {
        body["system"] = json!(system_parts.join("\n\n"));
    }
    let resp = reqwest::Client::new()
        .post(format!("{}/v1/messages", base.trim_end_matches('/')))
        .header("x-api-key", &cfg.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("claude: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Upstream(format!("claude {status}: {text}")));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| AppError::Upstream(e.to_string()))?;
    let content = v["content"][0]["text"].as_str().unwrap_or("").to_string();
    let prompt = v["usage"]["input_tokens"].as_u64().unwrap_or(0) as u32;
    let completion = v["usage"]["output_tokens"].as_u64().unwrap_or(0) as u32;
    Ok(ChatOutcome {
        content,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cost_cents: cents_from_tokens("claude", &cfg.model, prompt, completion),
    })
}

async fn call_gemini(cfg: &LlmConfig, messages: &[ChatMsg]) -> Result<ChatOutcome, AppError> {
    let base = cfg.base_url.as_deref().unwrap_or("https://generativelanguage.googleapis.com/v1beta");
    let mut system_parts: Vec<String> = Vec::new();
    let mut contents: Vec<Value> = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "system" => system_parts.push(m.content.clone()),
            "assistant" => contents.push(json!({"role": "model", "parts": [{"text": m.content}]})),
            _ => contents.push(json!({"role": "user", "parts": [{"text": m.content}]})),
        }
    }
    let mut body = json!({ "contents": contents });
    if !system_parts.is_empty() {
        body["systemInstruction"] = json!({"parts": [{"text": system_parts.join("\n\n")}]});
    }
    let url = format!(
        "{}/models/{}:generateContent?key={}",
        base.trim_end_matches('/'),
        cfg.model,
        cfg.api_key,
    );
    let resp = reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Upstream(format!("gemini: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Upstream(format!("gemini {status}: {text}")));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| AppError::Upstream(e.to_string()))?;
    let mut content = String::new();
    if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
        for p in parts {
            if let Some(t) = p["text"].as_str() {
                content.push_str(t);
            }
        }
    }
    let prompt = v["usageMetadata"]["promptTokenCount"].as_u64().unwrap_or(0) as u32;
    let completion = v["usageMetadata"]["candidatesTokenCount"].as_u64().unwrap_or(0) as u32;
    Ok(ChatOutcome {
        content,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cost_cents: cents_from_tokens("gemini", &cfg.model, prompt, completion),
    })
}
