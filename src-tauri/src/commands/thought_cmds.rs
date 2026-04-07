use tauri::State;

use crate::AppCore;

#[tauri::command]
pub fn create_thought(state: State<AppCore>, content: String) -> Result<echomind_core::Thought, String> {
    state.0.create_thought(&content)
}

#[tauri::command]
pub fn list_thoughts(state: State<AppCore>) -> Result<Vec<echomind_core::Thought>, String> {
    state.0.list_thoughts()
}

#[tauri::command]
pub fn get_thought(state: State<AppCore>, id: String) -> Result<echomind_core::Thought, String> {
    state.0.get_thought(&id)
}

#[tauri::command]
pub fn update_thought(state: State<AppCore>, id: String, content: String) -> Result<echomind_core::Thought, String> {
    state.0.update_thought(&id, &content)
}

#[tauri::command]
pub fn archive_thought(state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.archive_thought(&id)
}

#[tauri::command]
pub fn list_archived_thoughts(state: State<AppCore>) -> Result<Vec<echomind_core::Thought>, String> {
    state.0.list_archived_thoughts()
}

#[tauri::command]
pub fn unarchive_thought(state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.unarchive_thought(&id)
}

#[tauri::command]
pub fn delete_thought(state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.delete_thought(&id)
}
