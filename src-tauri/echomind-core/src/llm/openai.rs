use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{AgentMessage, AgentTurn, ChatMessage, LLMProvider, ModelConfig, Tool, ToolCall};

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

    async fn analyze_image(
        &self,
        text_prompt: &str,
        image_base64: &str,
        mime_type: &str,
        config: &ModelConfig,
    ) -> Result<String, String> {
        let base_url = config.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL);

        let data_url = format!("data:{};base64,{}", mime_type, image_base64);

        let body = json!({
            "model": config.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": text_prompt},
                    {"type": "image_url", "image_url": {"url": data_url}}
                ]
            }],
            "max_tokens": config.max_tokens.unwrap_or(2048),
        });

        let resp = Client::new()
            .post(format!("{}/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI vision request failed: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("OpenAI vision API error ({}): {}", status, text));
        }

        let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No content in OpenAI vision response".to_string())
    }

    async fn complete_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<Tool>,
        config: &ModelConfig,
    ) -> Result<AgentTurn, String> {
        let base_url = config.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL);

        // Convert AgentMessage to OpenAI message format.
        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| match m {
                AgentMessage::System { content } => json!({"role": "system", "content": content}),
                AgentMessage::User { content } => json!({"role": "user", "content": content}),
                AgentMessage::Assistant { content, tool_calls } => {
                    let mut obj = json!({"role": "assistant", "content": content});
                    if !tool_calls.is_empty() {
                        let calls: Vec<Value> = tool_calls
                            .iter()
                            .map(|tc| {
                                json!({
                                    "id": tc.id,
                                    "type": "function",
                                    "function": {
                                        "name": tc.name,
                                        "arguments": tc.arguments.to_string(),
                                    }
                                })
                            })
                            .collect();
                        obj["tool_calls"] = json!(calls);
                    }
                    obj
                }
                AgentMessage::ToolResult { tool_call_id, content, .. } => json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content,
                }),
            })
            .collect();

        let tools_json: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters_schema,
                    }
                })
            })
            .collect();

        let mut body = json!({
            "model": config.model,
            "messages": msgs,
        });
        if !tools_json.is_empty() {
            body["tools"] = json!(tools_json);
        }
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
        let msg = &json["choices"][0]["message"];
        let text_out = msg["content"].as_str().unwrap_or("").to_string();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        if let Some(arr) = msg["tool_calls"].as_array() {
            for tc in arr {
                let id = tc["id"].as_str().unwrap_or("").to_string();
                let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let arguments: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                tool_calls.push(ToolCall { id, name, arguments });
            }
        }
        Ok(AgentTurn { text: text_out, tool_calls })
    }
}
