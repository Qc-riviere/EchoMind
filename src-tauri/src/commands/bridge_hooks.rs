use tauri::{AppHandle, Manager};

use crate::AppCore;

pub fn spawn_push(app: AppHandle, thought_id: String) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppCore>();
        let _ = state.0.bridge_push_thought(&thought_id).await;
    });
}

pub fn spawn_delete(app: AppHandle, thought_id: String) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppCore>();
        let _ = state.0.bridge_delete_thought(&thought_id).await;
    });
}
