pub mod db;
pub mod llm;

use std::path::Path;
use std::sync::Mutex;

use db::{conversations, settings, thoughts, vectors};
use llm::{embedding, ChatMessage, EmbeddingConfig, ModelConfig, ProviderType};

// Re-export key types
pub use db::conversations::{Conversation, Message};
pub use db::thoughts::Thought;
pub use llm::{ChatMessage as LlmChatMessage, EmbeddingConfig as LlmEmbeddingConfig, ModelConfig as LlmModelConfig, ProviderType as LlmProviderType};

pub const INTERROGATION_SYSTEM_PROMPT: &str = r#"你是 EchoMind 的「灵魂拷问」AI 助手。你的目标是帮用户把一个模糊的灵感想清楚。

你的拷问框架：
1. 这个想法解决什么问题？谁有这个问题？
2. 现在人们怎么解决？为什么不够好？
3. 你的方案和直接用 XX（现有方案）有什么区别？
4. 壁垒在哪？别人为什么不容易抄？
5. 市场有多大？值得做吗？

规则：
- 每次只问 1-2 个问题，不要一次性问完
- 根据用户回答推进，不要重复已回答的问题
- 如果用户的回答暴露了逻辑漏洞，直接指出
- 语气友好但犀利，像一个有经验的创业导师
- 用中文回答"#;

/// High-level EchoMind API wrapping database and LLM operations.
/// Thread-safe via internal Mutex on the SQLite connection.
pub struct EchoMind {
    conn: Mutex<rusqlite::Connection>,
}

impl EchoMind {
    /// Open (or create) an EchoMind database at the given path.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = db::init::initialize_database(db_path)
            .map_err(|e| format!("Failed to initialize database: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Get a lock on the database connection.
    fn conn(&self) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
        self.conn.lock().map_err(|e| e.to_string())
    }

    // ── Thought CRUD ──────────────────────────────────────────

    pub fn create_thought(&self, content: &str) -> Result<Thought, String> {
        let conn = self.conn()?;
        thoughts::create_thought(&conn, content).map_err(|e| e.to_string())
    }

    pub fn create_thought_with_image(&self, content: &str, image_path: &str) -> Result<Thought, String> {
        let conn = self.conn()?;
        thoughts::create_thought_with_image(&conn, content, Some(image_path)).map_err(|e| e.to_string())
    }

    pub fn list_thoughts(&self) -> Result<Vec<Thought>, String> {
        let conn = self.conn()?;
        thoughts::list_thoughts(&conn).map_err(|e| e.to_string())
    }

    pub fn get_thought(&self, id: &str) -> Result<Thought, String> {
        let conn = self.conn()?;
        thoughts::get_thought(&conn, id).map_err(|e| e.to_string())
    }

    pub fn update_thought(&self, id: &str, content: &str) -> Result<Thought, String> {
        let conn = self.conn()?;
        thoughts::update_thought(&conn, id, content).map_err(|e| e.to_string())
    }

    pub fn archive_thought(&self, id: &str) -> Result<(), String> {
        let conn = self.conn()?;
        thoughts::archive_thought(&conn, id).map_err(|e| e.to_string())
    }

    pub fn unarchive_thought(&self, id: &str) -> Result<(), String> {
        let conn = self.conn()?;
        thoughts::unarchive_thought(&conn, id).map_err(|e| e.to_string())
    }

    pub fn delete_thought(&self, id: &str) -> Result<(), String> {
        let conn = self.conn()?;
        thoughts::delete_thought(&conn, id).map_err(|e| e.to_string())
    }

    pub fn list_archived_thoughts(&self) -> Result<Vec<Thought>, String> {
        let conn = self.conn()?;
        thoughts::list_archived_thoughts(&conn).map_err(|e| e.to_string())
    }

    // ── Settings ──────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        settings::get_setting(&conn, key).map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn()?;
        settings::set_setting(&conn, key, value).map_err(|e| e.to_string())
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let conn = self.conn()?;
        settings::delete_setting(&conn, key).map_err(|e| e.to_string())
    }

    pub fn get_all_settings(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn()?;
        settings::get_all_settings(&conn).map_err(|e| e.to_string())
    }

    // ── Conversations ─────────────────────────────────────────

    pub fn get_conversations(&self, thought_id: &str) -> Result<Vec<Conversation>, String> {
        let conn = self.conn()?;
        conversations::get_conversations_for_thought(&conn, thought_id)
            .map_err(|e| e.to_string())
    }

    pub fn start_chat(&self, thought_id: &str) -> Result<Conversation, String> {
        let conn = self.conn()?;
        // Resume existing conversation if one exists
        let existing = conversations::get_conversations_for_thought(&conn, thought_id)
            .map_err(|e| e.to_string())?;
        if let Some(conv) = existing.into_iter().next() {
            return Ok(conv);
        }
        conversations::create_conversation(&conn, thought_id).map_err(|e| e.to_string())
    }

    pub fn get_chat_messages(&self, conversation_id: &str) -> Result<Vec<Message>, String> {
        let conn = self.conn()?;
        conversations::get_messages(&conn, conversation_id).map_err(|e| e.to_string())
    }

    // ── LLM Config helpers ────────────────────────────────────

    pub fn load_llm_config(&self) -> Result<(ProviderType, ModelConfig), String> {
        let conn = self.conn()?;
        Self::load_llm_config_from_conn(&conn)
    }

    fn load_llm_config_from_conn(conn: &rusqlite::Connection) -> Result<(ProviderType, ModelConfig), String> {
        let provider_str = settings::get_setting(conn, "llm_provider")
            .map_err(|e| e.to_string())?
            .ok_or("LLM provider not configured. Please set up in Settings.")?;

        let provider_type: ProviderType =
            serde_json::from_str(&format!("\"{}\"", provider_str)).map_err(|_| {
                format!(
                    "Unknown provider: {}. Use openai, claude, or gemini.",
                    provider_str
                )
            })?;

        let api_key = settings::get_setting(conn, "llm_api_key")
            .map_err(|e| e.to_string())?
            .ok_or("API Key not configured. Please set up in Settings.")?;

        let model = settings::get_setting(conn, "llm_model")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| match provider_type {
                ProviderType::OpenAI => "gpt-4o-mini".to_string(),
                ProviderType::Claude => "claude-sonnet-4-20250514".to_string(),
                ProviderType::Gemini => "gemini-2.0-flash".to_string(),
            });

        let base_url = settings::get_setting(conn, "llm_base_url")
            .map_err(|e| e.to_string())?;

        Ok((
            provider_type,
            ModelConfig {
                api_key,
                model,
                base_url,
                temperature: Some(0.7),
                max_tokens: Some(2048),
            },
        ))
    }

    pub fn load_embedding_config(&self) -> Result<EmbeddingConfig, String> {
        let conn = self.conn()?;
        Self::load_embedding_config_from_conn(&conn)
    }

    fn load_embedding_config_from_conn(conn: &rusqlite::Connection) -> Result<EmbeddingConfig, String> {
        let dimensions: u32 = settings::get_setting(conn, "embedding_dimensions")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "1536".to_string())
            .parse()
            .map_err(|_| "Invalid embedding dimensions")?;

        let emb_api_key = settings::get_setting(conn, "embedding_api_key")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());

        let emb_model = settings::get_setting(conn, "embedding_model")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());

        let (api_key, base_url, model) = if let Some(key) = emb_api_key {
            let url = settings::get_setting(conn, "embedding_base_url")
                .map_err(|e| e.to_string())?
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "https://api.openai.com/v1/embeddings".to_string());
            let m = emb_model.unwrap_or_else(|| "text-embedding-3-small".to_string());
            (key, url, m)
        } else {
            let llm_key = settings::get_setting(conn, "llm_api_key")
                .map_err(|e| e.to_string())?
                .filter(|s| !s.is_empty())
                .ok_or("API Key not configured. Please set up in Settings.")?;

            let provider_str = settings::get_setting(conn, "llm_provider")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "openai".to_string());

            match provider_str.as_str() {
                "gemini" => (
                    llm_key,
                    "https://generativelanguage.googleapis.com/v1beta".to_string(),
                    emb_model
                        .filter(|m| m.contains("embedding-") && !m.contains("openai") && !m.starts_with("text-embedding-3") && m != "text-embedding-ada-002")
                        .unwrap_or_else(|| "gemini-embedding-exp-03-07".to_string()),
                ),
                _ => (
                    llm_key,
                    "https://api.openai.com/v1/embeddings".to_string(),
                    emb_model
                        .filter(|m| !m.contains("004") && !m.contains("gecko"))
                        .unwrap_or_else(|| "text-embedding-3-small".to_string()),
                ),
            }
        };

        Ok(EmbeddingConfig {
            api_key,
            model,
            base_url,
            dimensions,
        })
    }

    // ── AI Operations ─────────────────────────────────────────

    /// Enrich a thought with AI-generated context, domain, and tags.
    pub async fn enrich_thought(&self, thought_id: &str) -> Result<Thought, String> {
        let (thought, provider_type, config) = {
            let conn = self.conn()?;
            let thought = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, pt, cfg)
        };

        let provider = llm::get_provider(provider_type);

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: r#"你是 EchoMind 的 AI 助手。用户刚记录了一条灵感。请简短补充上下文。

严格按 JSON 格式返回，每个字段尽量简短：
{"context":"一句话说明背景和意图（不超过30字）","domain":"一个领域词","tags":"关键词1,关键词2"}

只返回 JSON，不要其他内容。"#
                    .to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: thought.content.clone(),
            },
        ];

        let response = provider.complete(messages, &config).await?;

        // Parse JSON response
        let cleaned = response.trim();
        let cleaned = cleaned.strip_prefix("```json").unwrap_or(cleaned);
        let cleaned = cleaned.strip_prefix("```").unwrap_or(cleaned);
        let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();
        let json_str = if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
            &cleaned[start..=end]
        } else {
            cleaned
        };
        let parsed: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse AI response: {}. Raw: {}", e, response))?;

        let context = parsed["context"].as_str().unwrap_or("").to_string();
        let domain = parsed["domain"].as_str().unwrap_or("").to_string();
        let tags = parsed["tags"].as_str().unwrap_or("").to_string();

        let conn = self.conn()?;
        thoughts::update_thought_enrichment(&conn, thought_id, &context, &domain, &tags)
            .map_err(|e| e.to_string())
    }

    /// Generate and store an embedding for a thought.
    pub async fn embed_thought(&self, thought_id: &str) -> Result<(), String> {
        let (thought, emb_config) = {
            let conn = self.conn()?;
            let thought = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
            let cfg = Self::load_embedding_config_from_conn(&conn)?;
            (thought, cfg)
        };

        let text_to_embed = if let Some(ref ctx) = thought.context {
            format!("{}\n{}", thought.content, ctx)
        } else {
            thought.content.clone()
        };

        let emb = embedding::generate_embedding(&text_to_embed, &emb_config).await?;

        let conn = self.conn()?;
        vectors::store_embedding(&conn, thought_id, &emb).map_err(|e| e.to_string())
    }

    /// Semantic search across all thoughts.
    pub async fn semantic_search(&self, query: &str) -> Result<Vec<Thought>, String> {
        let emb_config = {
            let conn = self.conn()?;
            Self::load_embedding_config_from_conn(&conn)?
        };

        let query_emb = embedding::generate_embedding(query, &emb_config).await?;

        let conn = self.conn()?;
        let results = vectors::search_similar(&conn, &query_emb, 10).map_err(|e| e.to_string())?;

        let mut found_thoughts = Vec::new();
        for (thought_id, _distance) in results {
            if let Ok(thought) = thoughts::get_thought(&conn, &thought_id) {
                if !thought.is_archived {
                    found_thoughts.push(thought);
                }
            }
        }

        Ok(found_thoughts)
    }

    /// Find thoughts related to a given thought.
    pub async fn find_related_thoughts(&self, thought_id: &str) -> Result<Vec<Thought>, String> {
        let conn = self.conn()?;
        let results = vectors::find_related(&conn, thought_id, 5).map_err(|e| e.to_string())?;

        let mut found_thoughts = Vec::new();
        for (tid, _distance) in results {
            if let Ok(thought) = thoughts::get_thought(&conn, &tid) {
                if !thought.is_archived {
                    found_thoughts.push(thought);
                }
            }
        }

        Ok(found_thoughts)
    }

    /// Send a chat message and get the full AI response (non-streaming).
    pub async fn send_chat_message(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<String, String> {
        // Save user message and load context
        let (thought, related_context, history, provider_type, config) = {
            let conn = self.conn()?;

            conversations::add_message(&conn, conversation_id, "user", content)
                .map_err(|e| e.to_string())?;

            let conv = conversations::get_conversation(&conn, conversation_id)
                .map_err(|e| e.to_string())?;
            let thought = thoughts::get_thought(&conn, &conv.thought_id)
                .map_err(|e| e.to_string())?;

            let related = vectors::find_related(&conn, &conv.thought_id, 3).unwrap_or_default();
            let mut related_context = String::new();
            for (tid, _) in &related {
                if let Ok(t) = thoughts::get_thought(&conn, tid) {
                    related_context.push_str(&format!("- {}\n", t.content));
                }
            }

            let msgs = conversations::get_messages(&conn, conversation_id)
                .map_err(|e| e.to_string())?;
            let history: Vec<ChatMessage> = msgs
                .iter()
                .map(|m| ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();

            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, related_context, history, pt, cfg)
        };

        // Build system prompt
        let mut system = format!(
            "{}\n\n---\n用户正在拷问的灵感：\n「{}」",
            INTERROGATION_SYSTEM_PROMPT, thought.content
        );
        if let Some(ctx) = &thought.context {
            system.push_str(&format!("\nAI 补充的上下文：{}", ctx));
        }
        if !related_context.is_empty() {
            system.push_str(&format!("\n\n用户的相关历史灵感：\n{}", related_context));
        }

        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system,
        }];
        messages.extend(history);

        // Get full response (non-streaming)
        let provider = llm::get_provider(provider_type);
        let response = provider.complete(messages, &config).await?;

        // Save assistant message
        if !response.is_empty() {
            let conn = self.conn()?;
            conversations::add_message(&conn, conversation_id, "assistant", &response)
                .map_err(|e| e.to_string())?;
        }

        Ok(response)
    }

    /// Send a chat message with streaming via an mpsc channel.
    /// Returns the full response after streaming completes.
    pub async fn send_chat_message_stream(
        &self,
        conversation_id: &str,
        content: &str,
        tx: tokio::sync::mpsc::Sender<String>,
    ) -> Result<String, String> {
        // Save user message and load context
        let (thought, related_context, history, provider_type, config) = {
            let conn = self.conn()?;

            conversations::add_message(&conn, conversation_id, "user", content)
                .map_err(|e| e.to_string())?;

            let conv = conversations::get_conversation(&conn, conversation_id)
                .map_err(|e| e.to_string())?;
            let thought = thoughts::get_thought(&conn, &conv.thought_id)
                .map_err(|e| e.to_string())?;

            let related = vectors::find_related(&conn, &conv.thought_id, 3).unwrap_or_default();
            let mut related_context = String::new();
            for (tid, _) in &related {
                if let Ok(t) = thoughts::get_thought(&conn, tid) {
                    related_context.push_str(&format!("- {}\n", t.content));
                }
            }

            let msgs = conversations::get_messages(&conn, conversation_id)
                .map_err(|e| e.to_string())?;
            let history: Vec<ChatMessage> = msgs
                .iter()
                .map(|m| ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();

            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, related_context, history, pt, cfg)
        };

        // Build system prompt
        let mut system = format!(
            "{}\n\n---\n用户正在拷问的灵感：\n「{}」",
            INTERROGATION_SYSTEM_PROMPT, thought.content
        );
        if let Some(ctx) = &thought.context {
            system.push_str(&format!("\nAI 补充的上下文：{}", ctx));
        }
        if !related_context.is_empty() {
            system.push_str(&format!("\n\n用户的相关历史灵感：\n{}", related_context));
        }

        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system,
        }];
        messages.extend(history);

        // Stream response
        let provider = llm::get_provider(provider_type);
        let (inner_tx, mut inner_rx) = tokio::sync::mpsc::channel::<String>(100);

        let stream_handle = tokio::spawn(async move {
            provider.complete_stream(messages, &config, inner_tx).await
        });

        let mut full_response = String::new();
        while let Some(token) = inner_rx.recv().await {
            full_response.push_str(&token);
            if tx.send(token).await.is_err() {
                break;
            }
        }

        if let Err(e) = stream_handle.await {
            return Err(format!("Stream error: {}", e));
        }

        // Save assistant message
        if !full_response.is_empty() {
            let conn = self.conn()?;
            conversations::add_message(&conn, conversation_id, "assistant", &full_response)
                .map_err(|e| e.to_string())?;
        }

        Ok(full_response)
    }

    // ── Model listing (pass-through to API) ───────────────────

    pub async fn test_llm_connection(&self) -> Result<String, String> {
        let (provider_type, config) = self.load_llm_config()?;
        let provider = llm::get_provider(provider_type);

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "Say 'Hello from EchoMind!' in one short sentence.".to_string(),
        }];

        provider.complete(messages, &config).await
    }

    pub async fn list_models(&self) -> Result<Vec<String>, String> {
        let (provider_type, config) = self.load_llm_config()?;
        let client = reqwest::Client::new();

        match provider_type {
            ProviderType::Gemini => {
                let base_url = config.base_url.as_deref()
                    .unwrap_or("https://generativelanguage.googleapis.com");
                let resp = client
                    .get(format!("{}/v1beta/models?key={}", base_url, config.api_key))
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;
                let text = resp.text().await.map_err(|e| e.to_string())?;
                let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let models = json["models"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["name"].as_str())
                            .map(|name| name.strip_prefix("models/").unwrap_or(name).to_string())
                            .filter(|name| name.contains("gemini"))
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            ProviderType::OpenAI => {
                let base_url = config.base_url.as_deref().unwrap_or("https://api.openai.com/v1");
                let resp = client
                    .get(format!("{}/models", base_url))
                    .header("Authorization", format!("Bearer {}", config.api_key))
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;
                let text = resp.text().await.map_err(|e| e.to_string())?;
                let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let mut models: Vec<String> = json["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["id"].as_str())
                            .map(|s| s.to_string())
                            .filter(|name| name.contains("gpt") || name.contains("o1") || name.contains("o3") || name.contains("o4"))
                            .collect()
                    })
                    .unwrap_or_default();
                models.sort();
                Ok(models)
            }
            ProviderType::Claude => {
                Ok(vec![
                    "claude-sonnet-4-20250514".to_string(),
                    "claude-haiku-4-20250506".to_string(),
                    "claude-opus-4-20250514".to_string(),
                ])
            }
        }
    }

    pub async fn list_embedding_models(&self) -> Result<Vec<String>, String> {
        let (emb_api_key, provider_str) = {
            let conn = self.conn()?;
            let emb_key = settings::get_setting(&conn, "embedding_api_key")
                .map_err(|e| e.to_string())?
                .filter(|s| !s.is_empty());
            let key = emb_key.or_else(|| {
                settings::get_setting(&conn, "llm_api_key").ok().flatten()
            }).ok_or("API key not configured")?;
            let provider = settings::get_setting(&conn, "llm_provider")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "openai".to_string());
            (key, provider)
        };

        let client = reqwest::Client::new();

        match provider_str.as_str() {
            "gemini" => {
                let resp = client
                    .get(format!(
                        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                        emb_api_key
                    ))
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;
                let text = resp.text().await.map_err(|e| e.to_string())?;
                let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let models = json["models"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter(|m| {
                                m["supportedGenerationMethods"]
                                    .as_array()
                                    .map(|methods| {
                                        methods.iter().any(|v| v.as_str() == Some("embedContent"))
                                    })
                                    .unwrap_or(false)
                            })
                            .filter_map(|m| m["name"].as_str())
                            .map(|name| name.strip_prefix("models/").unwrap_or(name).to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            _ => {
                let resp = client
                    .get("https://api.openai.com/v1/models")
                    .header("Authorization", format!("Bearer {}", emb_api_key))
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;
                let text = resp.text().await.map_err(|e| e.to_string())?;
                let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let mut models: Vec<String> = json["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["id"].as_str())
                            .filter(|name| name.contains("embedding"))
                            .map(|s| s.to_string())
                            .collect()
                    })
                    .unwrap_or_else(|| vec![
                        "text-embedding-3-small".to_string(),
                        "text-embedding-3-large".to_string(),
                        "text-embedding-ada-002".to_string(),
                    ]);
                models.sort();
                Ok(models)
            }
        }
    }

    // ── Status ────────────────────────────────────────────────

    pub fn status(&self) -> Result<serde_json::Value, String> {
        let conn = self.conn()?;
        let thought_count: i64 = conn
            .query_row("SELECT count(*) FROM thoughts WHERE is_archived = 0", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let archived_count: i64 = conn
            .query_row("SELECT count(*) FROM thoughts WHERE is_archived = 1", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let conversation_count: i64 = conn
            .query_row("SELECT count(*) FROM conversations", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "thoughts": thought_count,
            "archived": archived_count,
            "conversations": conversation_count,
        }))
    }
}
