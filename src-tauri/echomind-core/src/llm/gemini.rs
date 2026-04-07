use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{ChatMessage, LLMProvider, ModelConfig};

pub struct GeminiProvider;

const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com";

#[async_trait]
impl LLMProvider for GeminiProvider {
    async fn complete(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
    ) -> Result<String, String> {
        let base_url = config
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL);

        let system_msg = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone());

        let contents: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({
                    "role": role,
                    "parts": [{"text": m.content}]
                })
            })
            .collect();

        let mut body = json!({ "contents": contents });

        if let Some(sys) = &system_msg {
            body["system_instruction"] = json!({
                "parts": [{"text": sys}]
            });
        }
        if let Some(t) = config.temperature {
            body["generationConfig"] = json!({ "temperature": t });
        }
        if let Some(mt) = config.max_tokens {
            let gc = body["generationConfig"].as_object_mut();
            match gc {
                Some(obj) => { obj.insert("maxOutputTokens".to_string(), json!(mt)); }
                None => { body["generationConfig"] = json!({ "maxOutputTokens": mt }); }
            }
        }

        let resp = Client::new()
            .post(format!(
                "{}/v1beta/models/{}:generateContent?key={}",
                base_url, config.model, config.api_key
            ))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("Gemini API error ({}): {}", status, text));
        }

        let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No content in Gemini response".to_string())
    }

    async fn complete_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
        tx: mpsc::Sender<String>,
    ) -> Result<(), String> {
        let base_url = config
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL);

        let system_msg = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone());

        let contents: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                let role = if m.role == "assistant" { "model" } else { "user" };
                json!({
                    "role": role,
                    "parts": [{"text": m.content}]
                })
            })
            .collect();

        let mut body = json!({ "contents": contents });

        if let Some(sys) = &system_msg {
            body["system_instruction"] = json!({
                "parts": [{"text": sys}]
            });
        }

        let resp = Client::new()
            .post(format!(
                "{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
                base_url, config.model, config.api_key
            ))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Gemini stream request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.map_err(|e| e.to_string())?;
            return Err(format!("Gemini API error: {}", text));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() || !line.starts_with("data: ") {
                    continue;
                }

                let data = &line[6..];
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if let Some(text) =
                        json["candidates"][0]["content"]["parts"][0]["text"].as_str()
                    {
                        if tx.send(text.to_string()).await.is_err() {
                            return Ok(());
                        }
                    }
                }
            }
        }

        Ok(())
    }
}
