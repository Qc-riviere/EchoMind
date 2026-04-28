pub mod agent;
pub mod bridge;
pub mod db;
pub mod file_extractor;
pub mod llm;
pub mod skills;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub domain: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    pub content_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeThoughts {
    pub recent: Vec<db::thoughts::Thought>,
    pub hot: Vec<db::thoughts::Thought>,
}

use agent::builtin_tools;
use db::{conversations, settings, thoughts, vectors};
use llm::{embedding, AgentMessage, ChatMessage, EmbeddingConfig, ModelConfig, ProviderType};

// Re-export key types
pub use agent::AgentEvent;
pub use skills::{Skill, SkillTrigger};
pub use db::conversations::{Conversation, ConversationWithPreview, Message};
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
    files_dir: std::path::PathBuf,
    skills_dir: std::path::PathBuf,
}

impl EchoMind {
    /// Open (or create) an EchoMind database at the given path.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = db::init::initialize_database(db_path)
            .map_err(|e| format!("Failed to initialize database: {}", e))?;

        let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
        let files_dir = parent.join("images");
        let skills_dir = parent.join("skills");
        llm::local_embedding::set_cache_dir(parent.join("embedding_models"));

        Ok(Self {
            conn: Mutex::new(conn),
            files_dir,
            skills_dir,
        })
    }

    /// Open with explicit files directory.
    pub fn open_with_files_dir(db_path: &Path, files_dir: &Path) -> Result<Self, String> {
        let conn = db::init::initialize_database(db_path)
            .map_err(|e| format!("Failed to initialize database: {}", e))?;
        let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
        let skills_dir = parent.join("skills");
        llm::local_embedding::set_cache_dir(parent.join("embedding_models"));
        Ok(Self {
            conn: Mutex::new(conn),
            files_dir: files_dir.to_path_buf(),
            skills_dir,
        })
    }

    /// Get a lock on the database connection.
    fn conn(&self) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
        self.conn.lock().map_err(|e| e.to_string())
    }

    /// Get the path to a stored file.
    fn get_file_path(&self, filename: &str) -> std::path::PathBuf {
        self.files_dir.join(filename)
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

    /// Return two slices for the home page: 5 most recent thoughts and 5 most-
    /// chatted thoughts. `hot` may be empty if no conversations exist yet.
    pub fn list_home_thoughts(&self) -> Result<HomeThoughts, String> {
        let conn = self.conn()?;
        let mut recent = thoughts::list_thoughts(&conn).map_err(|e| e.to_string())?;
        recent.truncate(5);
        let hot = thoughts::list_hot_thoughts(&conn, 5).map_err(|e| e.to_string())?;
        Ok(HomeThoughts { recent, hot })
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

    pub fn list_recent_conversations(&self, limit: usize) -> Result<Vec<conversations::ConversationWithPreview>, String> {
        let conn = self.conn()?;
        conversations::list_recent_conversations(&conn, limit).map_err(|e| e.to_string())
    }

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

    pub fn withdraw_message(&self, message_id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn()?;
        conversations::withdraw_message(&conn, message_id).map_err(|e| e.to_string())
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
        let emb_provider = settings::get_setting(conn, "embedding_provider")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase());

        let emb_api_key = settings::get_setting(conn, "embedding_api_key")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());

        let llm_key_cfg = settings::get_setting(conn, "llm_api_key")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());

        let use_local = matches!(emb_provider.as_deref(), Some("local"))
            || (emb_provider.is_none() && emb_api_key.is_none() && llm_key_cfg.is_none());

        if use_local {
            let dimensions: u32 = settings::get_setting(conn, "embedding_dimensions")
                .map_err(|e| e.to_string())?
                .as_deref()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(crate::llm::local_embedding::LOCAL_EMBED_DIM as u32);
            return Ok(EmbeddingConfig {
                api_key: String::new(),
                model: "bge-small-zh-v1.5".to_string(),
                base_url: "local".to_string(),
                dimensions,
            });
        }

        let dimensions: u32 = settings::get_setting(conn, "embedding_dimensions")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "1536".to_string())
            .parse()
            .map_err(|_| "Invalid embedding dimensions")?;

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
            let llm_key = llm_key_cfg
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
    /// Now supports analyzing attached file content.
    pub async fn enrich_thought(&self, thought_id: &str) -> Result<Thought, String> {
        let (thought, provider_type, config) = {
            let conn = self.conn()?;
            let thought = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, pt, cfg)
        };

        let provider = llm::get_provider(provider_type);

        fn truncate_at_char_boundary(s: &str, max_chars: usize) -> String {
            let char_count = s.chars().count();
            if char_count <= max_chars {
                s.to_string()
            } else {
                s.chars().take(max_chars).collect::<String>() + "...[内容已截断]"
            }
        }

        let system_prompt = r#"你是 EchoMind 的 AI 助手。用户刚记录了一条灵感，可能附带文件或图片。

请分析内容并返回 JSON：
{
  "context": "一句话说明背景和意图（不超过30字）",
  "domain": "一个领域词",
  "tags": "关键词1,关键词2",
  "file_summary": "如果用户附带了文件或图片，用2-3句话总结其核心内容；如果没有则为空字符串"
}

严格规则：
- 只返回 JSON，不要任何其他文字、注释或 markdown 围栏
- JSON 字符串值内绝对不要使用 ASCII 双引号 "。如果需要引用，用中文「」或单引号 '
- 不要在字符串值中使用换行符"#;

        let mut user_content = thought.content.clone();
        let mut file_summary: Option<String> = None;
        let mut image_data: Option<(String, String)> = None; // (base64, mime_type)

        if let Some(ref filename) = thought.image_path {
            let file_path = self.get_file_path(filename);
            if file_path.exists() {
                let ext = file_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");

                if file_extractor::can_extract_text(ext) {
                    if let Ok(content) = file_extractor::extract_text_from_file(&file_path) {
                        let truncated = truncate_at_char_boundary(&content, 8000);
                        user_content = format!(
                            "{}\n\n附件文件内容：\n{}",
                            thought.content, truncated
                        );
                    }
                } else if file_extractor::is_image_file(ext) {
                    if let Ok(bytes) = std::fs::read(&file_path) {
                        use base64::Engine;
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        let mime = match ext.to_lowercase().as_str() {
                            "jpg" | "jpeg" => "image/jpeg",
                            "png" => "image/png",
                            "gif" => "image/gif",
                            "webp" => "image/webp",
                            _ => "image/png",
                        };
                        image_data = Some((b64, mime.to_string()));
                    }
                }
            }
        }

        let response = if let Some((b64, mime)) = image_data {
            // Use vision API for images
            let prompt = format!(
                "{}\n\n用户的灵感笔记：{}\n\n请分析这张图片以及笔记，并按要求返回 JSON。",
                system_prompt, thought.content
            );
            provider.analyze_image(&prompt, &b64, &mime, &config).await?
        } else {
            let messages = vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_content,
                },
            ];
            self.complete_via_route(messages).await?
        };

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
        
        let file_summary_str = parsed["file_summary"].as_str().unwrap_or("");
        if !file_summary_str.is_empty() {
            file_summary = Some(file_summary_str.to_string());
        }

        let conn = self.conn()?;
        thoughts::update_thought_enrichment(&conn, thought_id, &context, &domain, &tags, file_summary.as_deref())
            .map_err(|e| e.to_string())
    }

    /// Generate and store an embedding for a thought.
    /// Now includes attached file content in the embedding.
    pub async fn embed_thought(&self, thought_id: &str) -> Result<(), String> {
        let (thought, emb_config) = {
            let conn = self.conn()?;
            let thought = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
            let cfg = Self::load_embedding_config_from_conn(&conn)?;
            (thought, cfg)
        };

        let mut text_to_embed = thought.content.clone();

        if let Some(ref summary) = thought.file_summary {
            text_to_embed.push_str(&format!("\n{}", summary));
        }
        if let Some(ref ctx) = thought.context {
            text_to_embed.push_str(&format!("\n{}", ctx));
        }
        if let Some(ref domain) = thought.domain {
            text_to_embed.push_str(&format!("\n{}", domain));
        }
        if let Some(ref tags) = thought.tags {
            text_to_embed.push_str(&format!("\n{}", tags));
        }

        if let Some(ref filename) = thought.image_path {
            let file_path = self.get_file_path(filename);
            if file_path.exists() {
                if let Ok(content) = file_extractor::extract_text_from_file(&file_path) {
                    text_to_embed.push_str(&format!("\n\n附件内容：\n{}", content));
                }
            }
        }

        let emb = embedding::generate_embedding(&text_to_embed, &emb_config).await?;

        let conn = self.conn()?;
        vectors::store_embedding(&conn, thought_id, &emb).map_err(|e| e.to_string())
    }

    /// Re-embed all non-archived thoughts. Useful after embedding logic changes.
    pub async fn reembed_all_thoughts(&self) -> Result<usize, String> {
        let thought_ids: Vec<String> = {
            let conn = self.conn()?;
            thoughts::list_thoughts(&conn)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|t| t.id)
                .collect()
        };

        let mut count = 0;
        for id in &thought_ids {
            if self.embed_thought(id).await.is_ok() {
                count += 1;
            }
        }
        Ok(count)
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

    /// Build a label for a graph node — short, human-readable.
    fn make_node_label(t: &Thought) -> String {
        let source = t
            .file_summary
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&t.content);
        const MAX: usize = 24;
        let chars: Vec<char> = source.chars().collect();
        if chars.len() <= MAX {
            chars.into_iter().collect()
        } else {
            let mut s: String = chars.into_iter().take(MAX).collect();
            s.push('…');
            s
        }
    }

    /// Build a full embedding graph: nodes = embedded non-archived thoughts,
    /// edges = top-k semantic neighbors per node, deduplicated.
    /// `max_distance` filters out weak edges (sqlite-vec distance, lower = closer).
    pub fn get_embedding_graph(
        &self,
        max_distance: f64,
        max_edges_per_node: usize,
    ) -> Result<GraphData, String> {
        let conn = self.conn()?;

        // Get all thoughts with embeddings, build a lookup of non-archived ones.
        let embedded_ids = vectors::get_all_embedding_ids(&conn).map_err(|e| e.to_string())?;
        let mut node_map: HashMap<String, GraphNode> = HashMap::new();
        for id in &embedded_ids {
            if let Ok(t) = thoughts::get_thought(&conn, id) {
                if t.is_archived {
                    continue;
                }
                node_map.insert(
                    t.id.clone(),
                    GraphNode {
                        id: t.id.clone(),
                        label: Self::make_node_label(&t),
                        domain: t.domain.clone(),
                        tags: t.tags.clone(),
                        created_at: t.created_at.clone(),
                        content_length: t.content.chars().count(),
                    },
                );
            }
        }

        // For each node, query its neighbors via sqlite-vec, dedupe edges.
        let mut seen_edges: HashSet<(String, String)> = HashSet::new();
        let mut edges: Vec<GraphEdge> = Vec::new();
        for id in node_map.keys().cloned().collect::<Vec<_>>() {
            // Pull a few extra in case some are archived/missing.
            let neighbors = vectors::find_related(&conn, &id, max_edges_per_node + 4)
                .unwrap_or_default();
            let mut kept = 0usize;
            for (nid, dist) in neighbors {
                if kept >= max_edges_per_node {
                    break;
                }
                if !node_map.contains_key(&nid) {
                    continue;
                }
                if dist > max_distance {
                    continue;
                }
                let key = if id < nid {
                    (id.clone(), nid.clone())
                } else {
                    (nid.clone(), id.clone())
                };
                if seen_edges.insert(key.clone()) {
                    edges.push(GraphEdge {
                        source: key.0,
                        target: key.1,
                        weight: (1.0 - dist).max(0.0),
                    });
                }
                kept += 1;
            }
        }

        let mut nodes: Vec<GraphNode> = node_map.into_values().collect();
        nodes.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(GraphData { nodes, edges })
    }

    /// Get the immediate neighbors of a single thought — used for incremental graph updates.
    pub fn get_thought_neighbors(
        &self,
        thought_id: &str,
        k: usize,
        max_distance: f64,
    ) -> Result<Vec<GraphEdge>, String> {
        let conn = self.conn()?;
        let neighbors = vectors::find_related(&conn, thought_id, k + 4)
            .map_err(|e| e.to_string())?;
        let mut edges = Vec::new();
        let mut kept = 0usize;
        for (nid, dist) in neighbors {
            if kept >= k {
                break;
            }
            if dist > max_distance {
                continue;
            }
            // Skip archived or missing.
            match thoughts::get_thought(&conn, &nid) {
                Ok(t) if !t.is_archived => {}
                _ => continue,
            }
            let (s, t) = if thought_id < nid.as_str() {
                (thought_id.to_string(), nid)
            } else {
                (nid, thought_id.to_string())
            };
            edges.push(GraphEdge {
                source: s,
                target: t,
                weight: (1.0 - dist).max(0.0),
            });
            kept += 1;
        }
        Ok(edges)
    }

    /// Build a single GraphNode for a given thought (used after enrichment to inject into the graph).
    pub fn get_graph_node(&self, thought_id: &str) -> Result<GraphNode, String> {
        let conn = self.conn()?;
        let t = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
        Ok(GraphNode {
            id: t.id.clone(),
            label: Self::make_node_label(&t),
            domain: t.domain.clone(),
            tags: t.tags.clone(),
            created_at: t.created_at.clone(),
            content_length: t.content.chars().count(),
        })
    }

    /// Send a chat message and get the full AI response (non-streaming).
    /// Build the chat system prompt with all available thought context.
    fn build_chat_system_prompt(&self, thought: &Thought, related_context: &str) -> String {
        let mut system = format!(
            "{}\n\n---\n用户正在拷问的灵感：\n「{}」",
            INTERROGATION_SYSTEM_PROMPT, thought.content
        );

        if let Some(ctx) = &thought.context {
            system.push_str(&format!("\nAI 补充的上下文：{}", ctx));
        }
        if let Some(domain) = &thought.domain {
            system.push_str(&format!("\n领域：{}", domain));
        }
        if let Some(tags) = &thought.tags {
            system.push_str(&format!("\n标签：{}", tags));
        }
        if let Some(summary) = &thought.file_summary {
            system.push_str(&format!("\n\n附件摘要：\n{}", summary));
        }

        // For text-extractable files, include truncated raw content
        if let Some(filename) = &thought.image_path {
            let file_path = self.get_file_path(filename);
            if file_path.exists() {
                let ext = file_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if file_extractor::can_extract_text(ext) {
                    if let Ok(content) = file_extractor::extract_text_from_file(&file_path) {
                        const MAX_CHARS: usize = 20000;
                        let total = content.chars().count();
                        if total <= MAX_CHARS {
                            system.push_str(&format!("\n\n附件原文：\n{}", content));
                        } else {
                            // Smart truncation: keep beginning + end, drop middle
                            let head: String = content.chars().take(MAX_CHARS * 2 / 3).collect();
                            let tail: String = content
                                .chars()
                                .skip(total - MAX_CHARS / 3)
                                .collect();
                            system.push_str(&format!(
                                "\n\n附件原文（共 {} 字符，已智能截断中段）：\n{}\n\n...[中间内容已省略]...\n\n{}",
                                total, head, tail
                            ));
                        }
                    }
                }
            }
        }

        if !related_context.is_empty() {
            system.push_str(&format!("\n\n用户的相关历史灵感：\n{}", related_context));
        }

        system
    }

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

        // Build system prompt with full thought context including file content
        let system = self.build_chat_system_prompt(&thought, &related_context);

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

        // Build system prompt with full thought context including file content
        let system = self.build_chat_system_prompt(&thought, &related_context);

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

    /// Send a chat message via the agent loop. The agent has access to built-in tools
    /// (search_thoughts, get_thought, list_recent_thoughts, create_thought, update_thought)
    /// and may call them autonomously to ground its answer.
    /// Events flow back through `tx`; final answer is also returned.
    pub async fn send_chat_message_agent(
        &self,
        conversation_id: &str,
        content: &str,
        tx: tokio::sync::mpsc::Sender<agent::AgentEvent>,
    ) -> Result<String, String> {
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
            let history: Vec<(String, String)> = msgs
                .iter()
                .map(|m| (m.role.clone(), m.content.clone()))
                .collect();

            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, related_context, history, pt, cfg)
        };

        let system = self.build_chat_system_prompt(&thought, &related_context);
        let mut messages: Vec<AgentMessage> =
            vec![AgentMessage::System { content: system }];
        for (role, content) in history {
            match role.as_str() {
                "user" => messages.push(AgentMessage::User { content }),
                "assistant" => messages.push(AgentMessage::Assistant {
                    content,
                    tool_calls: vec![],
                }),
                _ => {}
            }
        }

        let mut registry = builtin_tools::default_registry();
        let skill_list = skills::load_skills_from_dir(&self.skills_dir);
        skills::register_skills(&mut registry, &skill_list);
        let final_text = agent::run_agent(
            self,
            provider_type,
            &config,
            &registry,
            messages,
            8,
            |evt| {
                let _ = tx.try_send(evt);
            },
        )
        .await?;

        if !final_text.is_empty() {
            let conn = self.conn()?;
            conversations::add_message(&conn, conversation_id, "assistant", &final_text)
                .map_err(|e| e.to_string())?;
        }

        Ok(final_text)
    }

    // ── Skills ──────────────────────────────────────────────────────────

    /// List all available skills.
    pub fn list_skills(&self) -> Vec<skills::Skill> {
        // Ensure skills dir exists
        let _ = std::fs::create_dir_all(&self.skills_dir);
        skills::load_skills_from_dir(&self.skills_dir)
    }

    /// Execute a manual skill: render its body with the given arguments.
    pub fn execute_skill(&self, skill_name: &str, args: &serde_json::Value) -> Result<String, String> {
        let all = self.list_skills();
        let skill = all
            .iter()
            .find(|s| s.name == skill_name)
            .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;
        Ok(skills::execute_skill(skill, args))
    }

    /// Get the skills directory path.
    pub fn skills_dir(&self) -> &std::path::Path {
        &self.skills_dir
    }

    /// Suggest online resources related to a thought using the LLM.
    pub async fn suggest_resources(&self, thought_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let (thought, chat_context, provider_type, config) = {
            let conn = self.conn()?;
            let thought = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;

            // Grab recent chat messages for richer context
            let convs = conversations::get_conversations_for_thought(&conn, thought_id)
                .unwrap_or_default();
            let mut chat_context = String::new();
            if let Some(conv) = convs.first() {
                let msgs = conversations::get_messages(&conn, &conv.id).unwrap_or_default();
                for m in msgs.iter().take(6) {
                    chat_context.push_str(&format!("[{}]: {}\n", m.role, m.content));
                }
            }

            let (pt, cfg) = Self::load_llm_config_from_conn(&conn)?;
            (thought, chat_context, pt, cfg)
        };

        // Build a rich description from all available thought fields
        let mut content_desc = format!("灵感内容：{}", thought.content);
        if let Some(ref summary) = thought.file_summary {
            content_desc.push_str(&format!("\n文件摘要：{}", summary));
        }
        if let Some(ref ctx) = thought.context {
            content_desc.push_str(&format!("\n背景：{}", ctx));
        }
        if let Some(ref domain) = thought.domain {
            content_desc.push_str(&format!("\n领域：{}", domain));
        }
        if let Some(ref tags) = thought.tags {
            content_desc.push_str(&format!("\n标签：{}", tags));
        }
        if !chat_context.is_empty() {
            content_desc.push_str(&format!("\n\n最近的讨论内容：\n{}", chat_context));
        }

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: r#"你是一个资源推荐助手。根据用户灵感的完整上下文（包括内容、文件摘要、标签、讨论），推荐 4-6 个与灵感主题直接相关的真实网络资源。

关键：仔细阅读所有提供的信息，理解灵感的核心主题，推荐的资源必须与这个主题紧密相关。

资源类型可以是：网站、文章、工具、开源项目、文档、书籍、课程等。

要求：
- 只推荐你确信真实存在的知名资源
- URL 必须是真实可访问的主域名或知名页面路径
- 资源必须与灵感的核心主题直接相关，不要推荐泛泛的技术工具
- 中英文资源都可以

返回 JSON 数组：
[
  {
    "title": "资源标题",
    "url": "https://...",
    "type": "article|tool|doc|project|book|course",
    "description": "一句话描述这个资源与灵感的关系"
  }
]

只返回 JSON 数组，不要其他内容。"#.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: content_desc,
            },
        ];

        let provider = llm::get_provider(provider_type);
        let response = provider.complete(messages, &config).await?;

        let cleaned = response.trim();
        let cleaned = cleaned.strip_prefix("```json").unwrap_or(cleaned);
        let cleaned = cleaned.strip_prefix("```").unwrap_or(cleaned);
        let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();
        let json_str = if let (Some(start), Some(end)) = (cleaned.find('['), cleaned.rfind(']')) {
            &cleaned[start..=end]
        } else {
            cleaned
        };

        let parsed: Vec<serde_json::Value> = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse resource suggestions: {}. Raw: {}", e, response))?;

        Ok(parsed)
    }

    // ── Model listing (pass-through to API) ───────────────────

    pub async fn test_llm_connection(&self) -> Result<String, String> {
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "Say 'Hello from EchoMind!' in one short sentence.".to_string(),
        }];
        self.complete_via_route(messages).await
    }

    /// Summarize a batch of thoughts into a markdown digest using the
    /// configured LLM (respecting the bridge-route toggle).
    pub async fn summarize_thoughts(&self, ids: &[String]) -> Result<String, String> {
        if ids.len() < 2 {
            return Err("至少选择 2 条灵感才能总结".into());
        }
        if ids.len() > 20 {
            return Err("一次最多总结 20 条灵感".into());
        }
        let mut buf = String::new();
        {
            let conn = self.conn()?;
            for (i, id) in ids.iter().enumerate() {
                let t = thoughts::get_thought(&conn, id).map_err(|e| e.to_string())?;
                buf.push_str(&format!(
                    "灵感 {}（{}）：\n{}\n",
                    i + 1,
                    t.created_at,
                    t.content
                ));
                if let Some(ctx) = &t.context {
                    if !ctx.is_empty() {
                        buf.push_str(&format!("背景：{ctx}\n"));
                    }
                }
                if let Some(tags) = &t.tags {
                    if !tags.is_empty() {
                        buf.push_str(&format!("标签：{tags}\n"));
                    }
                }
                buf.push('\n');
            }
        }
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "你是灵感整理助手。把用户提供的多条灵感笔记归纳成一段 Markdown 总结：先用一句话提炼共同主题，再用 3-5 条要点列出各灵感之间的关联或差异，最后给一条可执行的建议。语气精炼，可以使用列表与中文。".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!("请总结以下 {} 条灵感：\n\n{}", ids.len(), buf),
            },
        ];
        self.complete_via_route(messages).await
    }

    /// Run a chat completion using the bridge as a relay if the user
    /// opted in to bridge-mode LLM calls; otherwise call the provider
    /// directly. Returns the assistant text.
    pub async fn complete_via_route(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<String, String> {
        if self.bridge_llm_via_bridge_is_on()? {
            if let Some(client) = self.bridge_client()? {
                let bridge_msgs: Vec<bridge::BridgeChatMessage> = messages
                    .iter()
                    .map(|m| bridge::BridgeChatMessage {
                        role: m.role.clone(),
                        content: m.content.clone(),
                    })
                    .collect();
                let resp = client.remote_chat(&bridge_msgs).await?;
                return Ok(resp.content);
            }
        }
        let (provider_type, config) = self.load_llm_config()?;
        let provider = llm::get_provider(provider_type);
        provider.complete(messages, &config).await
    }

    pub fn bridge_llm_via_bridge_is_on(&self) -> Result<bool, String> {
        let conn = self.conn()?;
        Ok(settings::get_setting(&conn, bridge::settings_keys::LLM_VIA_BRIDGE)
            .map_err(|e| e.to_string())?
            .map(|v| v == "1" || v == "true")
            .unwrap_or(false))
    }

    pub fn bridge_set_llm_via_bridge(&self, enabled: bool) -> Result<(), String> {
        let conn = self.conn()?;
        settings::set_setting(
            &conn,
            bridge::settings_keys::LLM_VIA_BRIDGE,
            if enabled { "1" } else { "0" },
        )
        .map_err(|e| e.to_string())
    }

    pub async fn list_models(&self) -> Result<Vec<String>, String> {
        let (provider_type, config) = self.load_llm_config()?;
        let client = reqwest::Client::new();

        match provider_type {
            ProviderType::Gemini => {
                let base_url = config.base_url.as_deref()
                    .unwrap_or("https://generativelanguage.googleapis.com/v1beta");
                let resp = client
                    .get(format!("{}/models?key={}", base_url, config.api_key))
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
                let base_url = config
                    .base_url
                    .as_deref()
                    .unwrap_or("https://api.anthropic.com");
                let resp = client
                    .get(format!("{}/v1/models?limit=1000", base_url.trim_end_matches('/')))
                    .header("x-api-key", &config.api_key)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await
                    .map_err(|e| format!("Request failed: {}", e))?;
                let status = resp.status();
                let text = resp.text().await.map_err(|e| e.to_string())?;
                if !status.is_success() {
                    return Err(format!("Anthropic models ({}): {}", status, text));
                }
                let json: serde_json::Value =
                    serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let mut models: Vec<String> = json["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["id"].as_str())
                            .map(|s| s.to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                // Newest first by descending id (model ids are date-versioned).
                models.sort_by(|a, b| b.cmp(a));
                Ok(models)
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

    // ── Bridge ────────────────────────────────────────────────

    /// Load the current bridge client from settings, if configured.
    /// Returns `Ok(None)` when the bridge is not paired yet.
    pub fn bridge_client(&self) -> Result<Option<bridge::BridgeClient>, String> {
        let conn = self.conn()?;
        let url = settings::get_setting(&conn, bridge::settings_keys::SERVER_URL)
            .map_err(|e| e.to_string())?;
        let token = settings::get_setting(&conn, bridge::settings_keys::TOKEN)
            .map_err(|e| e.to_string())?;
        match (url, token) {
            (Some(u), Some(t)) if !u.is_empty() && !t.is_empty() => {
                Ok(Some(bridge::BridgeClient::new(u, Some(t))))
            }
            _ => Ok(None),
        }
    }

    pub fn bridge_get_subset_rules(&self) -> Result<bridge::SubsetRules, String> {
        let conn = self.conn()?;
        let raw = settings::get_setting(&conn, bridge::settings_keys::SUBSET_RULES)
            .map_err(|e| e.to_string())?;
        match raw {
            Some(s) if !s.is_empty() => serde_json::from_str(&s)
                .map_err(|e| format!("parse subset_rules: {e}")),
            _ => Ok(bridge::SubsetRules::default()),
        }
    }

    pub fn bridge_set_subset_rules(&self, rules: &bridge::SubsetRules) -> Result<(), String> {
        let s = serde_json::to_string(rules).map_err(|e| e.to_string())?;
        let conn = self.conn()?;
        settings::set_setting(&conn, bridge::settings_keys::SUBSET_RULES, &s)
            .map_err(|e| e.to_string())
    }

    pub fn bridge_is_enabled(&self) -> Result<bool, String> {
        let conn = self.conn()?;
        Ok(settings::get_setting(&conn, bridge::settings_keys::ENABLED)
            .map_err(|e| e.to_string())?
            .map(|v| v == "1" || v == "true")
            .unwrap_or(false))
    }

    pub fn bridge_set_enabled(&self, enabled: bool) -> Result<(), String> {
        let conn = self.conn()?;
        settings::set_setting(
            &conn,
            bridge::settings_keys::ENABLED,
            if enabled { "1" } else { "0" },
        )
        .map_err(|e| e.to_string())
    }

    /// Perform first-time pairing. Persists sync_key, device_id, and token on success.
    pub async fn bridge_pair(
        &self,
        server_url: &str,
        device_code: &str,
    ) -> Result<String, String> {
        // Reuse existing sync_key if any, else generate.
        let (sync_key, fp) = {
            let conn = self.conn()?;
            let existing = settings::get_setting(&conn, bridge::settings_keys::SYNC_KEY)
                .map_err(|e| e.to_string())?
                .filter(|s| !s.is_empty());
            let key = existing.unwrap_or_else(bridge::generate_sync_key);
            let fp = bridge::fingerprint_sync_key(&key);
            (key, fp)
        };

        let mut client = bridge::BridgeClient::new(server_url, None);
        let resp = client.pair(device_code.trim(), &fp).await?;

        let conn = self.conn()?;
        settings::set_setting(&conn, bridge::settings_keys::SERVER_URL, server_url)
            .map_err(|e| e.to_string())?;
        settings::set_setting(&conn, bridge::settings_keys::SYNC_KEY, &sync_key)
            .map_err(|e| e.to_string())?;
        settings::set_setting(&conn, bridge::settings_keys::SYNC_KEY_FP, &fp)
            .map_err(|e| e.to_string())?;
        settings::set_setting(&conn, bridge::settings_keys::DEVICE_ID, &resp.device_id)
            .map_err(|e| e.to_string())?;
        settings::set_setting(&conn, bridge::settings_keys::TOKEN, &resp.token)
            .map_err(|e| e.to_string())?;
        Ok(resp.device_id)
    }

    /// Push a single thought if the subset rules accept it. Returns true if pushed.
    pub async fn bridge_push_thought(&self, thought_id: &str) -> Result<bool, String> {
        if !self.bridge_is_enabled()? {
            return Ok(false);
        }
        let Some(client) = self.bridge_client()? else {
            return Ok(false);
        };
        let (thought, embedding, rules) = {
            let conn = self.conn()?;
            let t = thoughts::get_thought(&conn, thought_id).map_err(|e| e.to_string())?;
            let emb = vectors::get_embedding(&conn, thought_id).map_err(|e| e.to_string())?;
            let raw = settings::get_setting(&conn, bridge::settings_keys::SUBSET_RULES)
                .map_err(|e| e.to_string())?;
            let rules: bridge::SubsetRules = match raw {
                Some(s) if !s.is_empty() => {
                    serde_json::from_str(&s).unwrap_or_default()
                }
                _ => bridge::SubsetRules::default(),
            };
            (t, emb, rules)
        };
        if !rules.matches(&thought) {
            // Thought no longer eligible — make sure VPS doesn't keep a stale copy.
            let _ = client.delete_thoughts(&[thought.id.clone()]).await;
            return Ok(false);
        }
        let payload = bridge::SubsetThoughtPayload::from_thought(&thought, embedding);
        client.upsert_thoughts(&[payload]).await?;
        Ok(true)
    }

    /// Delete a thought from the remote subset (idempotent).
    pub async fn bridge_delete_thought(&self, thought_id: &str) -> Result<(), String> {
        if !self.bridge_is_enabled()? {
            return Ok(());
        }
        let Some(client) = self.bridge_client()? else {
            return Ok(());
        };
        client.delete_thoughts(&[thought_id.to_string()]).await?;
        Ok(())
    }

    /// Initial full-sync: push every thought that matches the current rules.
    pub async fn bridge_initial_sync(&self) -> Result<usize, String> {
        let Some(client) = self.bridge_client()? else {
            return Err("bridge not paired".into());
        };
        let (thoughts_all, rules) = {
            let conn = self.conn()?;
            let all = thoughts::list_thoughts(&conn).map_err(|e| e.to_string())?;
            let raw = settings::get_setting(&conn, bridge::settings_keys::SUBSET_RULES)
                .map_err(|e| e.to_string())?;
            let rules: bridge::SubsetRules = match raw {
                Some(s) if !s.is_empty() => serde_json::from_str(&s).unwrap_or_default(),
                _ => bridge::SubsetRules::default(),
            };
            (all, rules)
        };
        let mut payloads: Vec<bridge::SubsetThoughtPayload> = Vec::new();
        for t in thoughts_all {
            if !rules.matches(&t) {
                continue;
            }
            let emb = {
                let conn = self.conn()?;
                vectors::get_embedding(&conn, &t.id).map_err(|e| e.to_string())?
            };
            payloads.push(bridge::SubsetThoughtPayload::from_thought(&t, emb));
        }
        // Chunk to keep request bodies bounded.
        let mut total = 0usize;
        for chunk in payloads.chunks(50) {
            total += client.upsert_thoughts(chunk).await?;
        }
        Ok(total)
    }

    /// Push the local LLM config to VPS (opt-in; caller must confirm consent).
    /// Reads provider/model/api_key/base_url from local settings.
    pub async fn bridge_push_llm_config(
        &self,
        budget_cents: Option<i64>,
    ) -> Result<(), String> {
        let Some(client) = self.bridge_client()? else {
            return Err("bridge not paired".into());
        };
        let (provider_type, cfg) = self.load_llm_config()?;
        let provider_str = match provider_type {
            crate::llm::ProviderType::Claude => "claude",
            crate::llm::ProviderType::OpenAI => "openai",
            crate::llm::ProviderType::Gemini => "gemini",
        };
        let llm_json = serde_json::json!({
            "provider": provider_str,
            "api_key": cfg.api_key,
            "model": cfg.model,
            "base_url": cfg.base_url,
        });
        client.push_llm_config(&llm_json, budget_cents).await
    }

    /// Remove the LLM config stored on the VPS.
    pub async fn bridge_clear_llm_config(&self) -> Result<(), String> {
        let Some(client) = self.bridge_client()? else {
            return Err("bridge not paired".into());
        };
        client.clear_llm_config().await
    }

    /// Get remote LLM usage/budget/disabled status.
    pub async fn bridge_remote_llm_status(
        &self,
    ) -> Result<bridge::RemoteLlmStatus, String> {
        let Some(client) = self.bridge_client()? else {
            return Err("bridge not paired".into());
        };
        client.remote_llm_status().await
    }

    /// Terminate the remote subscription: wipe cloud data, clear local bridge settings.
    pub async fn bridge_terminate(&self) -> Result<(), String> {
        if let Some(client) = self.bridge_client()? {
            let _ = client.terminate().await;
        }
        let conn = self.conn()?;
        for k in [
            bridge::settings_keys::TOKEN,
            bridge::settings_keys::DEVICE_ID,
            bridge::settings_keys::ENABLED,
        ] {
            let _ = settings::delete_setting(&conn, k);
        }
        Ok(())
    }

    /// Pull new thoughts from the bridge and merge them into the local DB.
    /// Uses `bridge_last_sync_at` as a cursor (RFC3339 timestamp), updated on
    /// success to the largest `updated_at` returned. Returns the number of
    /// rows inserted or updated.
    pub async fn bridge_sync_pull(&self) -> Result<usize, String> {
        if !self.bridge_is_enabled()? {
            return Ok(0);
        }
        let Some(client) = self.bridge_client()? else {
            return Ok(0);
        };
        let since = {
            let conn = self.conn()?;
            settings::get_setting(&conn, bridge::settings_keys::LAST_SYNC_AT)
                .map_err(|e| e.to_string())?
                .filter(|s| !s.is_empty())
        };

        let mut changed = 0usize;
        let mut cursor = since.clone();
        loop {
            let batch = client
                .fetch_thoughts_since(cursor.as_deref(), 200)
                .await?;
            if batch.is_empty() {
                break;
            }
            let conn = self.conn()?;
            let mut max_updated = cursor.clone().unwrap_or_default();
            for r in &batch {
                let tags_joined = r.tags.as_ref().map(|v| v.join(","));
                let applied = thoughts::upsert_from_remote(
                    &conn,
                    &r.id,
                    &r.content,
                    r.domain.as_deref(),
                    tags_joined.as_deref(),
                    &r.created_at,
                    &r.updated_at,
                )
                .map_err(|e| e.to_string())?;
                if applied {
                    changed += 1;
                }
                if r.updated_at > max_updated {
                    max_updated = r.updated_at.clone();
                }
            }
            if !max_updated.is_empty() {
                settings::set_setting(
                    &conn,
                    bridge::settings_keys::LAST_SYNC_AT,
                    &max_updated,
                )
                .map_err(|e| e.to_string())?;
                cursor = Some(max_updated);
            }
            if batch.len() < 200 {
                break;
            }
        }
        Ok(changed)
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
