use tauri::State;

use crate::AppCore;

#[tauri::command]
pub async fn enrich_thought(
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<echomind_core::Thought, String> {
    state.0.enrich_thought(&thought_id).await
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
    state: State<'_, AppCore>,
    thought_id: String,
) -> Result<(), String> {
    state.0.embed_thought(&thought_id).await
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
