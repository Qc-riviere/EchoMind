use tauri::{AppHandle, Manager, State};

use crate::AppCore;
use super::bridge_hooks;

#[tauri::command]
pub fn create_thought(
    app: AppHandle,
    state: State<AppCore>,
    content: String,
) -> Result<echomind_core::Thought, String> {
    let t = state.0.create_thought(&content)?;
    bridge_hooks::spawn_push(app, t.id.clone());
    Ok(t)
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
pub fn update_thought(
    app: AppHandle,
    state: State<AppCore>,
    id: String,
    content: String,
) -> Result<echomind_core::Thought, String> {
    let t = state.0.update_thought(&id, &content)?;
    bridge_hooks::spawn_push(app, t.id.clone());
    Ok(t)
}

#[tauri::command]
pub fn archive_thought(app: AppHandle, state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.archive_thought(&id)?;
    // Archiving may make the thought fail subset rules → push handles delete automatically.
    bridge_hooks::spawn_push(app, id);
    Ok(())
}

#[tauri::command]
pub fn list_archived_thoughts(
    state: State<AppCore>,
) -> Result<Vec<echomind_core::Thought>, String> {
    state.0.list_archived_thoughts()
}

#[tauri::command]
pub fn unarchive_thought(app: AppHandle, state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.unarchive_thought(&id)?;
    bridge_hooks::spawn_push(app, id);
    Ok(())
}

#[tauri::command]
pub fn delete_thought(app: AppHandle, state: State<AppCore>, id: String) -> Result<(), String> {
    state.0.delete_thought(&id)?;
    bridge_hooks::spawn_delete(app, id);
    Ok(())
}

/// Returns the full local file path for a thought's image filename.
#[tauri::command]
pub fn get_image_path(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("images").join(&filename);
    if path.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err(format!("Image not found: {}", filename))
    }
}

/// Save a base64-encoded image to the images directory. Returns the filename.
#[tauri::command]
pub fn save_image(
    app: tauri::AppHandle,
    data: String,
    ext: String,
    original_name: Option<String>,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = app_dir.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = if let Some(name) = original_name {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let name_without_ext = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(&name);
        format!("{}-{}.{}", name_without_ext, timestamp, ext)
    } else {
        format!("desktop-{}.{}", chrono::Utc::now().timestamp_millis(), ext)
    };

    let path = images_dir.join(&filename);

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(filename)
}

/// Create a thought with an image attached.
#[tauri::command]
pub fn create_thought_with_image(
    app: AppHandle,
    state: State<AppCore>,
    content: String,
    image_path: String,
) -> Result<echomind_core::Thought, String> {
    let t = state.0.create_thought_with_image(&content, &image_path)?;
    bridge_hooks::spawn_push(app, t.id.clone());
    Ok(t)
}

/// Open a file with the system's default application.
#[tauri::command]
pub fn open_file(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("images").join(&filename);

    if !path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// Build the full embedding graph for visualization.
#[tauri::command]
pub fn get_embedding_graph(
    state: State<AppCore>,
    max_distance: Option<f64>,
    max_edges_per_node: Option<usize>,
) -> Result<echomind_core::GraphData, String> {
    state
        .0
        .get_embedding_graph(max_distance.unwrap_or(0.6), max_edges_per_node.unwrap_or(5))
}

/// Get neighbor edges for a single thought (for incremental graph updates).
#[tauri::command]
pub fn get_thought_neighbors(
    state: State<AppCore>,
    thought_id: String,
    k: Option<usize>,
    max_distance: Option<f64>,
) -> Result<Vec<echomind_core::GraphEdge>, String> {
    state
        .0
        .get_thought_neighbors(&thought_id, k.unwrap_or(5), max_distance.unwrap_or(0.6))
}

/// Build a single GraphNode for a thought (after enrichment).
#[tauri::command]
pub fn get_graph_node(
    state: State<AppCore>,
    thought_id: String,
) -> Result<echomind_core::GraphNode, String> {
    state.0.get_graph_node(&thought_id)
}

/// Read the content of a text file.
#[tauri::command]
pub fn read_file_content(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("images").join(&filename);

    if !path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if echomind_core::file_extractor::can_extract_text(ext) {
        echomind_core::file_extractor::extract_text_from_file(&path)
    } else {
        Err(format!("Cannot read content of .{} files", ext))
    }
}
