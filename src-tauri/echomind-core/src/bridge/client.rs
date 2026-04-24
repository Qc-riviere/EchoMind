use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::thoughts::Thought;

#[derive(Debug, Clone)]
pub struct BridgeClient {
    base_url: String,
    token: Option<String>,
    http: Client,
}

#[derive(Debug, Deserialize)]
pub struct PairResponse {
    pub token: String,
    pub device_id: String,
}

#[derive(Debug, Serialize)]
pub struct SubsetThoughtPayload {
    pub id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
}

impl SubsetThoughtPayload {
    pub fn from_thought(t: &Thought, embedding: Option<Vec<f32>>) -> Self {
        let tags = t.tags.as_deref().map(|s| {
            s.split(|c: char| c == ',' || c == '，' || c == ';')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
        });
        Self {
            id: t.id.clone(),
            content: t.content.clone(),
            created_at: t.created_at.clone(),
            updated_at: t.updated_at.clone(),
            tags,
            domain: t.domain.clone(),
            embedding,
        }
    }
}

impl BridgeClient {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, String> {
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| "bridge not paired (no token)".to_string())?;
        Ok(req.bearer_auth(token))
    }

    pub async fn health(&self) -> Result<(), String> {
        let resp = self
            .http
            .get(self.url("/health"))
            .send()
            .await
            .map_err(|e| format!("bridge health: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("bridge health: {}", resp.status()));
        }
        Ok(())
    }

    pub async fn pair(
        &mut self,
        device_code: &str,
        sync_key_fp: &str,
    ) -> Result<PairResponse, String> {
        let resp = self
            .http
            .post(self.url("/bridge/pair"))
            .json(&json!({
                "device_code": device_code,
                "sync_key_fp": sync_key_fp,
            }))
            .send()
            .await
            .map_err(|e| format!("bridge pair: {e}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("bridge pair ({}): {}", status, body));
        }
        let parsed: PairResponse =
            serde_json::from_str(&body).map_err(|e| format!("bridge pair decode: {e}"))?;
        self.token = Some(parsed.token.clone());
        Ok(parsed)
    }

    pub async fn upsert_config(
        &self,
        bot_token: Option<&str>,
        subset_rules: Option<&Value>,
        llm_config: Option<&Value>,
    ) -> Result<(), String> {
        let body = json!({
            "bot_token": bot_token,
            "subset_rules": subset_rules,
            "llm_config": llm_config,
        });
        let req = self.http.post(self.url("/bridge/config")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        expect_ok(resp).await
    }

    pub async fn upsert_thoughts(
        &self,
        thoughts: &[SubsetThoughtPayload],
    ) -> Result<usize, String> {
        if thoughts.is_empty() {
            return Ok(0);
        }
        let body = json!({ "thoughts": thoughts });
        let req = self.http.post(self.url("/bridge/thoughts/upsert")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        Ok(v["accepted"].as_u64().unwrap_or(0) as usize)
    }

    pub async fn delete_thoughts(&self, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }
        let req = self
            .http
            .post(self.url("/bridge/thoughts/delete"))
            .json(&json!({ "ids": ids }));
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        Ok(v["deleted"].as_u64().unwrap_or(0) as usize)
    }

    pub async fn terminate(&self) -> Result<(), String> {
        let req = self.http.post(self.url("/bridge/terminate"));
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        expect_ok(resp).await
    }

    /// Fetch thoughts from the bridge, optionally filtered by updated_at > since.
    /// `since` is an RFC 3339 timestamp string (e.g. the last `updated_at`
    /// we've already synced). Pass `None` on first sync to get most recent.
    pub async fn fetch_thoughts_since(
        &self,
        since: Option<&str>,
        limit: i64,
    ) -> Result<Vec<RemoteThought>, String> {
        let mut url = format!("{}/bridge/thoughts?limit={}", self.base_url, limit);
        if let Some(s) = since {
            let encoded = percent_encode(s);
            url.push_str(&format!("&since={encoded}"));
        }
        let req = self.http.get(url);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        let arr = v["thoughts"].as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|t| serde_json::from_value(t).ok())
            .collect())
    }

    /// Capture a new thought on the VPS (bridge mode, no local desktop needed).
    pub async fn capture_thought(
        &self,
        content: &str,
        tags: Option<&[String]>,
    ) -> Result<RemoteCaptureResponse, String> {
        let body = json!({
            "content": content,
            "tags": tags,
        });
        let req = self.http.post(self.url("/bridge/thoughts/capture")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        Ok(RemoteCaptureResponse {
            id: v["id"].as_str().unwrap_or("").to_string(),
            content: v["content"].as_str().unwrap_or("").to_string(),
            created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        })
    }

    /// Push the encrypted LLM config (and optional budget cap) to the VPS.
    pub async fn push_llm_config(
        &self,
        llm_config: &Value,
        budget_cents: Option<i64>,
    ) -> Result<(), String> {
        let body = json!({
            "llm_config": llm_config,
            "budget_cents": budget_cents,
        });
        let req = self.http.post(self.url("/bridge/config")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        expect_ok(resp).await
    }

    /// Clear the LLM config stored on the VPS (set to null).
    pub async fn clear_llm_config(&self) -> Result<(), String> {
        let body = json!({ "llm_config": null });
        let req = self.http.post(self.url("/bridge/config")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        expect_ok(resp).await
    }

    /// Send a chat request to the VPS for remote LLM execution.
    pub async fn remote_chat(&self, messages: &[ChatMessage]) -> Result<RemoteChatResponse, String> {
        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect();
        let body = json!({ "messages": msgs });
        let req = self.http.post(self.url("/bridge/chat")).json(&body);
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        Ok(RemoteChatResponse {
            content: v["content"].as_str().unwrap_or("").to_string(),
            prompt_tokens: v["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: v["completion_tokens"].as_u64().unwrap_or(0) as u32,
            cost_cents: v["cost_cents"].as_i64().unwrap_or(0),
            usage_cents: v["usage_cents"].as_i64().unwrap_or(0),
            llm_disabled: v["llm_disabled"].as_bool().unwrap_or(false),
        })
    }

    /// Get remote LLM usage/budget/disabled status.
    pub async fn remote_llm_status(&self) -> Result<RemoteLlmStatus, String> {
        let req = self.http.get(self.url("/bridge/status"));
        let resp = self.auth(req)?.send().await.map_err(|e| e.to_string())?;
        let v = expect_json(resp).await?;
        Ok(RemoteLlmStatus {
            has_llm_config: v["has_llm_config"].as_bool().unwrap_or(false),
            llm_disabled: v["llm_disabled"].as_bool().unwrap_or(false),
            usage_cents: v["usage_cents"].as_i64().unwrap_or(0),
            budget_cents: v["budget_cents"].as_i64(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteCaptureResponse {
    pub id: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteThought {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteChatResponse {
    pub content: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_cents: i64,
    pub usage_cents: i64,
    pub llm_disabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteLlmStatus {
    pub has_llm_config: bool,
    pub llm_disabled: bool,
    pub usage_cents: i64,
    pub budget_cents: Option<i64>,
}

async fn expect_ok(resp: reqwest::Response) -> Result<(), String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(format!("bridge request failed ({status}): {body}"))
}

async fn expect_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("bridge request failed ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("bridge decode: {e}"))
}

// Unused but re-exported to silence dead-code when token refresh is added later.
#[allow(dead_code)]
pub(crate) const _UNAUTH: StatusCode = StatusCode::UNAUTHORIZED;
