use tauri::State;

use crate::db::{settings, thoughts, vectors};
use crate::llm::{self, embedding, ChatMessage, EmbeddingConfig, ModelConfig, ProviderType};
use crate::DbState;

fn load_llm_config(conn: &rusqlite::Connection) -> Result<(ProviderType, ModelConfig), String> {
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

#[tauri::command]
pub async fn enrich_thought(
    state: State<'_, DbState>,
    thought_id: String,
) -> Result<thoughts::Thought, String> {
    // Read thought and config from DB (inside mutex scope)
    let (thought, provider_type, config) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let thought = thoughts::get_thought(&conn, &thought_id).map_err(|e| e.to_string())?;
        let (pt, cfg) = load_llm_config(&conn)?;
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
    // Strip markdown code fences and find the JSON object
    let cleaned = response.trim();
    let cleaned = cleaned.strip_prefix("```json").unwrap_or(cleaned);
    let cleaned = cleaned.strip_prefix("```").unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();
    // Extract just the JSON object portion
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

    // Update thought in DB
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE thoughts SET context = ?1, domain = ?2, tags = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![context, domain, tags, now, thought_id],
    )
    .map_err(|e| e.to_string())?;

    thoughts::get_thought(&conn, &thought_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_llm_connection(
    state: State<'_, DbState>,
) -> Result<String, String> {
    let (provider_type, config) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        load_llm_config(&conn)?
    };

    let provider = llm::get_provider(provider_type);

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: "Say 'Hello from EchoMind!' in one short sentence.".to_string(),
    }];

    let response = provider.complete(messages, &config).await?;
    Ok(response)
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let (provider_type, config) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        load_llm_config(&conn)?
    };

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
            // Anthropic has no public list-models endpoint for most users
            Ok(vec![
                "claude-sonnet-4-20250514".to_string(),
                "claude-haiku-4-20250506".to_string(),
                "claude-opus-4-20250514".to_string(),
            ])
        }
    }
}

#[tauri::command]
pub async fn list_embedding_models(
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let (emb_api_key, provider_str) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
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
            // OpenAI-compatible: filter embedding models
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

fn load_embedding_config(conn: &rusqlite::Connection) -> Result<EmbeddingConfig, String> {
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
        // Separate embedding key configured — use full embedding config
        let url = settings::get_setting(conn, "embedding_base_url")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://api.openai.com/v1/embeddings".to_string());
        let m = emb_model.unwrap_or_else(|| "text-embedding-3-small".to_string());
        (key, url, m)
    } else {
        // No separate embedding key — derive everything from LLM provider
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
                // Only use stored model if it looks like a Gemini model
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

#[tauri::command]
pub async fn embed_thought(
    state: State<'_, DbState>,
    thought_id: String,
) -> Result<(), String> {
    let (thought, emb_config) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let thought = thoughts::get_thought(&conn, &thought_id).map_err(|e| e.to_string())?;
        let cfg = load_embedding_config(&conn)?;
        (thought, cfg)
    };

    // Build text to embed: content + context for richer semantics
    let text_to_embed = if let Some(ref ctx) = thought.context {
        format!("{}\n{}", thought.content, ctx)
    } else {
        thought.content.clone()
    };

    let emb = embedding::generate_embedding(&text_to_embed, &emb_config).await?;

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    vectors::store_embedding(&conn, &thought_id, &emb).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn semantic_search(
    state: State<'_, DbState>,
    query: String,
) -> Result<Vec<thoughts::Thought>, String> {
    let emb_config = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        load_embedding_config(&conn)?
    };

    let query_emb = embedding::generate_embedding(&query, &emb_config).await?;

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub async fn find_related_thoughts(
    state: State<'_, DbState>,
    thought_id: String,
) -> Result<Vec<thoughts::Thought>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let results = vectors::find_related(&conn, &thought_id, 5).map_err(|e| e.to_string())?;

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
