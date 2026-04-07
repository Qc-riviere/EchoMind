use serde::Serialize;
use tauri::{Emitter, State};
use tokio::sync::mpsc;

use crate::AppCore;

#[derive(Clone, Serialize)]
struct StreamPayload {
    conversation_id: String,
    token: String,
    is_done: bool,
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
    let (tx, mut rx) = mpsc::channel::<String>(100);

    let conv_id = conversation_id.clone();
    let app_handle = app.clone();

    // Spawn a task to forward tokens to Tauri events
    let forward_handle = tokio::spawn(async move {
        while let Some(token) = rx.recv().await {
            let _ = app_handle.emit(
                "chat-stream",
                StreamPayload {
                    conversation_id: conv_id.clone(),
                    token,
                    is_done: false,
                },
            );
        }
    });

    // Delegate to core's streaming API
    let _full_response = state
        .0
        .send_chat_message_stream(&conversation_id, &content, tx)
        .await?;

    // Wait for forwarding to finish
    let _ = forward_handle.await;

    // Emit done signal
    let _ = app.emit(
        "chat-stream",
        StreamPayload {
            conversation_id,
            token: String::new(),
            is_done: true,
        },
    );

    Ok(())
}
