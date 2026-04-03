use tauri::State;

use crate::db::thoughts;
use crate::DbState;

#[tauri::command]
pub fn create_thought(state: State<DbState>, content: String) -> Result<thoughts::Thought, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::create_thought(&conn, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_thoughts(state: State<DbState>) -> Result<Vec<thoughts::Thought>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::list_thoughts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_thought(state: State<DbState>, id: String) -> Result<thoughts::Thought, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::get_thought(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_thought(
    state: State<DbState>,
    id: String,
    content: String,
) -> Result<thoughts::Thought, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::update_thought(&conn, &id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn archive_thought(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::archive_thought(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_archived_thoughts(state: State<DbState>) -> Result<Vec<thoughts::Thought>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::list_archived_thoughts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unarchive_thought(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::unarchive_thought(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_thought(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    thoughts::delete_thought(&conn, &id).map_err(|e| e.to_string())
}
