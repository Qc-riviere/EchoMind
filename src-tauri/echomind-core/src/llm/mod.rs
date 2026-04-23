pub mod claude;
pub mod embedding;
pub mod gemini;
pub mod local_embedding;
pub mod openai;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,   // "system", "user", "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub dimensions: u32,
}

/// A tool the agent can call. `parameters_schema` is a JSON Schema describing the args object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub parameters_schema: Value,
}

/// A request from the model to invoke a tool. `id` is opaque (provider-assigned).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// Agent-flavored message — supports tool calls / tool results in addition to plain text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentMessage {
    #[serde(rename = "system")]
    System { content: String },
    #[serde(rename = "user")]
    User { content: String },
    #[serde(rename = "assistant")]
    Assistant {
        content: String,
        #[serde(default)]
        tool_calls: Vec<ToolCall>,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_call_id: String,
        name: String,
        content: String,
    },
}

/// One turn of model output: free-form text plus zero or more tool calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurn {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

#[async_trait]
pub trait LLMProvider: Send + Sync {
    async fn complete(&self, messages: Vec<ChatMessage>, config: &ModelConfig) -> Result<String, String>;

    async fn complete_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
        tx: mpsc::Sender<String>,
    ) -> Result<(), String>;

    /// Analyze an image with an optional accompanying text prompt.
    /// `image_base64` should be the raw base64-encoded image bytes (no data URL prefix).
    /// `mime_type` is e.g. "image/png", "image/jpeg".
    async fn analyze_image(
        &self,
        text_prompt: &str,
        image_base64: &str,
        mime_type: &str,
        config: &ModelConfig,
    ) -> Result<String, String>;

    /// Agent-style completion with tool calling. Returns the model's text and any tool calls
    /// the model wants to make. The caller (agent loop) is responsible for executing the tools
    /// and feeding results back as `AgentMessage::ToolResult` on the next call.
    async fn complete_with_tools(
        &self,
        messages: Vec<AgentMessage>,
        tools: Vec<Tool>,
        config: &ModelConfig,
    ) -> Result<AgentTurn, String>;
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    OpenAI,
    Claude,
    Gemini,
}

pub fn get_provider(provider_type: ProviderType) -> Box<dyn LLMProvider> {
    match provider_type {
        ProviderType::OpenAI => Box::new(openai::OpenAIProvider),
        ProviderType::Claude => Box::new(claude::ClaudeProvider),
        ProviderType::Gemini => Box::new(gemini::GeminiProvider),
    }
}
