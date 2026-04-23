use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, State};
use tokio::sync::mpsc;

use crate::AppCore;

#[derive(Clone, Serialize)]
struct StreamPayload {
    conversation_id: String,
    token: String,
    is_done: bool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind")]
enum AgentEventPayload {
    #[serde(rename = "text")]
    Text { conversation_id: String, text: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        conversation_id: String,
        id: String,
        name: String,
        arguments: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        conversation_id: String,
        id: String,
        name: String,
        result: String,
    },
    #[serde(rename = "tool_error")]
    ToolError {
        conversation_id: String,
        id: String,
        name: String,
        error: String,
    },
    #[serde(rename = "done")]
    Done { conversation_id: String, text: String },
}

#[tauri::command]
pub async fn list_recent_conversations(
    state: State<'_, AppCore>,
) -> Result<Vec<echomind_core::ConversationWithPreview>, String> {
    state.0.list_recent_conversations(20)
}

#[tauri::command]
pub async fn get_conversations(
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<Vec<echomind_core::Conversation>, String> {
    state.0.get_conversations(&thought_id)
}

#[tauri::command]
pub async fn start_chat(
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<echomind_core::Conversation, String> {
    state.0.start_chat(&thought_id)
}

#[tauri::command]
pub async fn get_chat_messages(
    state: State<'_, AppCore>,
    conversation_id: String,
) -> Result<Vec<echomind_core::Message>, String> {
    state.0.get_chat_messages(&conversation_id)
}

#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    state: State<'_, AppCore>,
    conversation_id: String,
    content: String,
) -> Result<(), String> {
    use echomind_core::AgentEvent;

    let (tx, mut rx) = mpsc::channel::<AgentEvent>(64);

    let conv_id = conversation_id.clone();
    let app_handle = app.clone();

    // Forward agent events to Tauri's "chat-agent" channel.
    let forward_handle = tokio::spawn(async move {
        while let Some(evt) = rx.recv().await {
            let payload = match evt {
                AgentEvent::Text(text) => AgentEventPayload::Text {
                    conversation_id: conv_id.clone(),
                    text,
                },
                AgentEvent::ToolCall { id, name, arguments } => AgentEventPayload::ToolCall {
                    conversation_id: conv_id.clone(),
                    id,
                    name,
                    arguments,
                },
                AgentEvent::ToolResult { id, name, result } => AgentEventPayload::ToolResult {
                    conversation_id: conv_id.clone(),
                    id,
                    name,
                    result,
                },
                AgentEvent::ToolError { id, name, error } => AgentEventPayload::ToolError {
                    conversation_id: conv_id.clone(),
                    id,
                    name,
                    error,
                },
                AgentEvent::Final(text) => AgentEventPayload::Done {
                    conversation_id: conv_id.clone(),
                    text,
                },
            };
            let _ = app_handle.emit("chat-agent", payload);
        }
    });

    // Run the agent loop.
    let result = state
        .0
        .send_chat_message_agent(&conversation_id, &content, tx)
        .await;

    let _ = forward_handle.await;

    // Always emit a stream-done signal so legacy listeners can stop spinners.
    let _ = app.emit(
        "chat-stream",
        StreamPayload {
            conversation_id: conversation_id.clone(),
            token: String::new(),
            is_done: true,
        },
    );

    result.map(|_| ())
}

/// Withdraw a user message and remove it + all subsequent messages from the DB.
/// Returns the list of deleted message IDs.
#[tauri::command]
pub async fn withdraw_message(
    state: State<'_, AppCore>,
    message_id: String,
) -> Result<Vec<String>, String> {
    state.0.withdraw_message(&message_id)
}
