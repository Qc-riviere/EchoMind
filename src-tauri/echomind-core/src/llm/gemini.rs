use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::{AgentMessage, AgentTurn, ChatMessage, LLMProvider, ModelConfig, Tool, ToolCall};

pub struct GeminiProvider;

const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

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
                "{}/models/{}:generateContent?key={}",
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
                "{}/models/{}:streamGenerateContent?alt=sse&key={}",
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

    async fn analyze_image(
        &self,
        text_prompt: &str,
        image_base64: &str,
        mime_type: &str,
        config: &ModelConfig,
    ) -> Result<String, String> {
        let base_url = config.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL);

        let body = json!({
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": text_prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": image_base64,
                        }
                    }
                ]
            }]
        });

        let resp = Client::new()
            .post(format!(
                "{}/models/{}:generateContent?key={}",
                base_url, config.model, config.api_key
            ))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Gemini vision request failed: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("Gemini vision API error ({}): {}", status, text));
        }

        let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No content in Gemini vision response".to_string())
    }

    async fn complete_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<Tool>,
        config: &ModelConfig,
    ) -> Result<AgentTurn, String> {
        let base_url = config.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL);

        // System message → system_instruction
        let system_msg = messages.iter().find_map(|m| match m {
            AgentMessage::System { content } => Some(content.clone()),
            _ => None,
        });

        // Build contents array. Gemini uses "user" and "model" roles.
        // Tool calls live in `parts[].functionCall`; tool results in `parts[].functionResponse`.
        let mut contents: Vec<Value> = Vec::new();
        for m in &messages {
            match m {
                AgentMessage::System { .. } => {}
                AgentMessage::User { content } => {
                    contents.push(json!({
                        "role": "user",
                        "parts": [{"text": content}]
                    }));
                }
                AgentMessage::Assistant { content, tool_calls } => {
                    let mut parts: Vec<Value> = Vec::new();
                    if !content.is_empty() {
                        parts.push(json!({"text": content}));
                    }
                    for tc in tool_calls {
                        parts.push(json!({
                            "functionCall": {
                                "name": tc.name,
                                "args": tc.arguments,
                            }
                        }));
                    }
                    contents.push(json!({"role": "model", "parts": parts}));
                }
                AgentMessage::ToolResult { name, content, .. } => {
                    // Gemini wants the result as JSON; wrap strings.
                    let response_value: Value = serde_json::from_str(content)
                        .unwrap_or_else(|_| json!({"result": content}));
                    contents.push(json!({
                        "role": "user",
                        "parts": [{
                            "functionResponse": {
                                "name": name,
                                "response": response_value,
                            }
                        }]
                    }));
                }
            }
        }

        let function_decls: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": to_gemini_schema(&t.parameters_schema),
                })
            })
            .collect();

        let mut body = json!({ "contents": contents });
        if let Some(sys) = &system_msg {
            body["system_instruction"] = json!({"parts": [{"text": sys}]});
        }
        if !function_decls.is_empty() {
            body["tools"] = json!([{ "function_declarations": function_decls }]);
        }
        if let Some(t) = config.temperature {
            body["generationConfig"] = json!({ "temperature": t });
        }

        let resp = Client::new()
            .post(format!(
                "{}/models/{}:generateContent?key={}",
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
        let mut text_out = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        if let Some(parts) = json["candidates"][0]["content"]["parts"].as_array() {
            for (i, p) in parts.iter().enumerate() {
                if let Some(s) = p["text"].as_str() {
                    text_out.push_str(s);
                }
                if let Some(fc) = p.get("functionCall") {
                    let name = fc["name"].as_str().unwrap_or("").to_string();
                    let arguments = fc["args"].clone();
                    // Gemini doesn't return an id; synthesize one for round-trip mapping.
                    tool_calls.push(ToolCall {
                        id: format!("call_{}", i),
                        name,
                        arguments,
                    });
                }
            }
        }
        Ok(AgentTurn { text: text_out, tool_calls })
    }
}

/// Convert a JSON Schema value into Gemini's schema format.
/// Gemini requires uppercase type names (STRING, NUMBER, INTEGER, BOOLEAN, OBJECT, ARRAY)
/// and does not support `default` or `$schema`. This function recursively converts.
fn to_gemini_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(obj) => {
            let mut out = serde_json::Map::new();
            for (key, val) in obj {
                match key.as_str() {
                    "type" => {
                        if let Some(t) = val.as_str() {
                            let upper = t.to_uppercase();
                            let valid = match upper.as_str() {
                                "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "OBJECT" | "ARRAY" => upper,
                                _ => "STRING".to_string(), // fallback for invalid types
                            };
                            out.insert("type".into(), json!(valid));
                        } else {
                            out.insert("type".into(), json!("STRING"));
                        }
                    }
                    // Gemini doesn't support these — skip them
                    "default" | "$schema" | "additionalProperties" => {}
                    // Recurse into nested schemas
                    "properties" => {
                        if let Some(props) = val.as_object() {
                            let converted: serde_json::Map<String, Value> = props
                                .iter()
                                .map(|(k, v)| (k.clone(), to_gemini_schema(v)))
                                .collect();
                            out.insert("properties".into(), Value::Object(converted));
                        }
                    }
                    "items" => {
                        out.insert("items".into(), to_gemini_schema(val));
                    }
                    _ => {
                        out.insert(key.clone(), val.clone());
                    }
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}
