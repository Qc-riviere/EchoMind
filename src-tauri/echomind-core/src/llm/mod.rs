pub mod claude;
pub mod embedding;
pub mod gemini;
pub mod openai;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
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

#[async_trait]
pub trait LLMProvider: Send + Sync {
    async fn complete(&self, messages: Vec<ChatMessage>, config: &ModelConfig) -> Result<String, String>;

    async fn complete_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: &ModelConfig,
        tx: mpsc::Sender<String>,
    ) -> Result<(), String>;
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
