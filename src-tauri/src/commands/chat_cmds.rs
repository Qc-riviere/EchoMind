use serde::Serialize;
use tauri::{Emitter, State};
use tokio::sync::mpsc;

use crate::db::{conversations, settings, thoughts, vectors};
use crate::llm::{self, ChatMessage, ModelConfig, ProviderType};
use crate::DbState;

#[derive(Clone, Serialize)]
struct StreamPayload {
    conversation_id: String,
    token: String,
    is_done: bool,
}

fn load_llm_config(conn: &rusqlite::Connection) -> Result<(ProviderType, ModelConfig), String> {
    let provider_str = settings::get_setting(conn, "llm_provider")
        .map_err(|e| e.to_string())?
        .ok_or("LLM provider not configured")?;

    let provider_type: ProviderType =
        serde_json::from_str(&format!("\"{}\"", provider_str))
            .map_err(|_| format!("Unknown provider: {}", provider_str))?;

    let api_key = settings::get_setting(conn, "llm_api_key")
        .map_err(|e| e.to_string())?
        .ok_or("API Key not configured")?;

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
            max_tokens: Some(1024),
        },
    ))
}

const INTERROGATION_SYSTEM_PROMPT: &str = r#"你是 EchoMind 的「灵魂拷问」AI 助手。你的目标是帮用户把一个模糊的灵感想清楚。

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

#[tauri::command]
pub async fn get_conversations(
    state: State<'_, DbState>,
    thought_id: String,
) -> Result<Vec<conversations::Conversation>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conversations::get_conversations_for_thought(&conn, &thought_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_chat(
    state: State<'_, DbState>,
    thought_id: String,
) -> Result<conversations::Conversation, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Resume existing conversation if one exists
    let existing = conversations::get_conversations_for_thought(&conn, &thought_id)
        .map_err(|e| e.to_string())?;
    if let Some(conv) = existing.into_iter().next() {
        return Ok(conv);
    }
    conversations::create_conversation(&conn, &thought_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_chat_messages(
    state: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<conversations::Message>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conversations::get_messages(&conn, &conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    conversation_id: String,
    content: String,
) -> Result<(), String> {
    // Save user message and load context
    let (thought, related_context, history, provider_type, config) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;

        // Save user message
        conversations::add_message(&conn, &conversation_id, "user", &content)
            .map_err(|e| e.to_string())?;

        // Get conversation to find thought
        let conv =
            conversations::get_conversation(&conn, &conversation_id).map_err(|e| e.to_string())?;
        let thought = thoughts::get_thought(&conn, &conv.thought_id).map_err(|e| e.to_string())?;

        // Get related thoughts for context
        let related = vectors::find_related(&conn, &conv.thought_id, 3).unwrap_or_default();
        let mut related_context = String::new();
        for (tid, _) in &related {
            if let Ok(t) = thoughts::get_thought(&conn, tid) {
                related_context.push_str(&format!("- {}\n", t.content));
            }
        }

        // Load chat history
        let msgs = conversations::get_messages(&conn, &conversation_id).map_err(|e| e.to_string())?;
        let history: Vec<ChatMessage> = msgs
            .iter()
            .map(|m| ChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let (pt, cfg) = load_llm_config(&conn)?;
        (thought, related_context, history, pt, cfg)
    };

    // Build system prompt with thought context
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
    let (tx, mut rx) = mpsc::channel::<String>(100);

    let conv_id = conversation_id.clone();
    let app_handle = app.clone();

    // Spawn streaming task
    let stream_handle = tokio::spawn(async move {
        provider.complete_stream(messages, &config, tx).await
    });

    // Collect full response while emitting tokens
    let mut full_response = String::new();
    while let Some(token) = rx.recv().await {
        full_response.push_str(&token);
        let _ = app_handle.emit(
            "chat-stream",
            StreamPayload {
                conversation_id: conv_id.clone(),
                token,
                is_done: false,
            },
        );
    }

    // Wait for stream to finish
    if let Err(e) = stream_handle.await {
        return Err(format!("Stream error: {}", e));
    }

    // Emit done signal
    let _ = app.emit(
        "chat-stream",
        StreamPayload {
            conversation_id: conversation_id.clone(),
            token: String::new(),
            is_done: true,
        },
    );

    // Save assistant message
    if !full_response.is_empty() {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conversations::add_message(&conn, &conversation_id, "assistant", &full_response)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
