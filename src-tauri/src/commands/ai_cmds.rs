use tauri::{AppHandle, State};

use crate::AppCore;
use super::bridge_hooks;

#[tauri::command]
pub async fn enrich_thought(
    app: AppHandle,
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<echomind_core::Thought, String> {
    let t = state.0.enrich_thought(&thought_id).await?;
    bridge_hooks::spawn_push(app, t.id.clone());
    Ok(t)
}

#[tauri::command]
pub async fn test_llm_connection(state: State<'_, AppCore>) -> Result<String, String> {
    state.0.test_llm_connection().await
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppCore>) -> Result<Vec<String>, String> {
    state.0.list_models().await
}

#[tauri::command]
pub async fn list_embedding_models(state: State<'_, AppCore>) -> Result<Vec<String>, String> {
    state.0.list_embedding_models().await
}

#[tauri::command]
pub async fn embed_thought(
    app: AppHandle,
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<(), String> {
    state.0.embed_thought(&thought_id).await?;
    bridge_hooks::spawn_push(app, thought_id);
    Ok(())
}

#[tauri::command]
pub async fn semantic_search(
    state: State<'_, AppCore>,
    query: String,
) -> Result<Vec<echomind_core::Thought>, String> {
    state.0.semantic_search(&query).await
}

#[tauri::command]
pub async fn find_related_thoughts(
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<Vec<echomind_core::Thought>, String> {
    state.0.find_related_thoughts(&thought_id).await
}

#[tauri::command]
pub async fn reembed_all_thoughts(state: State<'_, AppCore>) -> Result<usize, String> {
    state.0.reembed_all_thoughts().await
}

#[tauri::command]
pub async fn suggest_resources(
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    state.0.suggest_resources(&thought_id).await
}
