use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{ChatMessage, LLMProvider, ModelConfig};

pub struct OpenAIProvider;

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[async_trait]
impl LLMProvider for OpenAIProvider {
    async fn complete(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
    ) -> Result<String, String> {
        let base_url = config
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL);

        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();

        let mut body = json!({
            "model": config.model,
            "messages": msgs,
        });

        if let Some(t) = config.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(mt) = config.max_tokens {
            body["max_tokens"] = json!(mt);
        }

        let resp = Client::new()
            .post(format!("{}/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("OpenAI API error ({}): {}", status, text));
        }

        let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No content in OpenAI response".to_string())
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

        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();

        let mut body = json!({
            "model": config.model,
            "messages": msgs,
            "stream": true,
        });

        if let Some(t) = config.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(mt) = config.max_tokens {
            body["max_tokens"] = json!(mt);
        }

        let resp = Client::new()
            .post(format!("{}/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI stream request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.map_err(|e| e.to_string())?;
            return Err(format!("OpenAI API error: {}", text));
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
                if data == "[DONE]" {
                    return Ok(());
                }

                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        if tx.send(content.to_string()).await.is_err() {
                            return Ok(());
                        }
                    }
                }
            }
        }

        Ok(())
    }
}
