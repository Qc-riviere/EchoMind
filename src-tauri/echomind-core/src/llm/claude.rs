use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{ChatMessage, LLMProvider, ModelConfig};

pub struct ClaudeProvider;

const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

#[async_trait]
impl LLMProvider for ClaudeProvider {
    async fn complete(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
    ) -> Result<String, String> {
        let base_url = config
            .base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL);

        // Extract system message if present
        let system_msg = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone());

        let msgs: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();

        let mut body = json!({
            "model": config.model,
            "messages": msgs,
            "max_tokens": config.max_tokens.unwrap_or(1024),
        });

        if let Some(sys) = &system_msg {
            body["system"] = json!(sys);
        }
        if let Some(t) = config.temperature {
            body["temperature"] = json!(t);
        }

        let resp = Client::new()
            .post(format!("{}/v1/messages", base_url))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Claude request failed: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("Claude API error ({}): {}", status, text));
        }

        let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        json["content"][0]["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No content in Claude response".to_string())
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

        let msgs: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect();

        let mut body = json!({
            "model": config.model,
            "messages": msgs,
            "max_tokens": config.max_tokens.unwrap_or(1024),
            "stream": true,
        });

        if let Some(sys) = &system_msg {
            body["system"] = json!(sys);
        }
        if let Some(t) = config.temperature {
            body["temperature"] = json!(t);
        }

        let resp = Client::new()
            .post(format!("{}/v1/messages", base_url))
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Claude stream request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.map_err(|e| e.to_string())?;
            return Err(format!("Claude API error: {}", text));
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
                    if json["type"] == "content_block_delta" {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            if tx.send(text.to_string()).await.is_err() {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }
}
