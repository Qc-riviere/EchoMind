use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::AppCore;

#[tauri::command]
pub async fn list_skills(state: State<'_, AppCore>) -> Result<Vec<echomind_core::Skill>, String> {
    Ok(state.0.list_skills())
}

#[tauri::command]
pub async fn execute_skill(
    state: State<'_, AppCore>,
    skill_name: String,
    args: Value,
) -> Result<String, String> {
    state.0.execute_skill(&skill_name, &args)
}

#[tauri::command]
pub async fn get_skills_dir(state: State<'_, AppCore>) -> Result<String, String> {
    Ok(state.0.skills_dir().to_string_lossy().to_string())
}

/// Save a skill file. `content` is the full markdown (frontmatter + body).
/// If the file already exists it will be overwritten.
#[tauri::command]
pub async fn save_skill(
    state: State<'_, AppCore>,
    filename: String,
    content: String,
) -> Result<(), String> {
    // Validate the content parses correctly
    echomind_core::skills::parse_skill(&content)?;
    let path = state.0.skills_dir().join(&filename);
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write skill: {e}"))
}

/// Delete a skill file by filename (e.g. "summarize.md").
#[tauri::command]
pub async fn delete_skill(
    state: State<'_, AppCore>,
    filename: String,
) -> Result<(), String> {
    let path = state.0.skills_dir().join(&filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete skill: {e}"))
    } else {
        Err("Skill file not found".into())
    }
}

// ── External skill scanner ─────────────────────────────────────────

/// A skill discovered from an external AI tool directory.
#[derive(Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    /// Human-readable source, e.g. "Claude Code", "Cursor", "Codex"
    pub source: String,
    /// Skill name parsed from frontmatter (or directory name as fallback)
    pub name: String,
    /// Description parsed from frontmatter
    pub description: String,
    /// The full markdown content of the source file
    pub content: String,
    /// Original file path
    pub path: String,
}

/// Scan well-known AI tool directories for importable skills.
#[tauri::command]
pub async fn scan_external_skills() -> Result<Vec<DiscoveredSkill>, String> {
    let home = dirs_next::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let mut found: Vec<DiscoveredSkill> = Vec::new();

    // Claude Code: ~/.claude/skills/<name>/SKILL.md
    let claude_skills = home.join(".claude").join("skills");
    scan_subdirs(&claude_skills, "Claude Code", &mut found);

    // Cursor: ~/.cursor/skills/<name>/SKILL.md
    let cursor_skills = home.join(".cursor").join("skills");
    scan_subdirs(&cursor_skills, "Cursor", &mut found);

    // Cursor (skills-cursor): ~/.cursor/skills-cursor/<name>/SKILL.md
    let cursor_skills2 = home.join(".cursor").join("skills-cursor");
    scan_subdirs(&cursor_skills2, "Cursor", &mut found);

    // Cursor rules: ~/.cursor/rules/*.mdc
    let cursor_rules = home.join(".cursor").join("rules");
    scan_flat_files(&cursor_rules, &["mdc", "md"], "Cursor Rules", &mut found);

    // Codex: ~/.codex/skills/<name>/SKILL.md
    let codex_skills = home.join(".codex").join("skills");
    scan_subdirs(&codex_skills, "Codex", &mut found);

    // Windsurf: ~/.windsurf/skills/<name>/SKILL.md
    let windsurf_skills = home.join(".windsurf").join("skills");
    scan_subdirs(&windsurf_skills, "Windsurf", &mut found);

    // Project-level: .claude/commands/*.md in working directory
    let cwd_claude = PathBuf::from(".claude").join("commands");
    scan_flat_files(&cwd_claude, &["md"], "Project (Claude)", &mut found);

    Ok(found)
}

/// Scan directories like ~/.claude/skills/ where each subdirectory has a SKILL.md
fn scan_subdirs(base: &Path, source: &str, out: &mut Vec<DiscoveredSkill>) {
    let entries = match std::fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let skill_file = dir.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&skill_file) {
            let (name, description) = parse_external_frontmatter(&content, &dir);
            out.push(DiscoveredSkill {
                source: source.to_string(),
                name,
                description,
                content,
                path: skill_file.to_string_lossy().to_string(),
            });
        }
    }
}

/// Scan a flat directory for skill files (e.g. .cursor/rules/*.mdc)
fn scan_flat_files(dir: &Path, extensions: &[&str], source: &str, out: &mut Vec<DiscoveredSkill>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !extensions.contains(&ext) {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            let fallback_name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            let (name, description) = parse_external_frontmatter(&content, &path);
            let name = if name == "unknown" { fallback_name } else { name };
            out.push(DiscoveredSkill {
                source: source.to_string(),
                name,
                description,
                content,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
}

/// Try to parse name and description from YAML frontmatter. Fallback to directory/file name.
fn parse_external_frontmatter(text: &str, fallback_path: &Path) -> (String, String) {
    let fallback_name = fallback_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let trimmed = text.trim();
    if !trimmed.starts_with("---") {
        return (fallback_name, String::new());
    }
    let rest = &trimmed[3..];
    let end = match rest.find("\n---") {
        Some(e) => e,
        None => return (fallback_name, String::new()),
    };
    let yaml_str = &rest[..end];

    // Simple extraction — avoid pulling in full serde_yaml here
    let mut name = fallback_name;
    let mut desc = String::new();
    for line in yaml_str.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().trim_matches('"').trim_matches('\'').to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            let val = val.trim();
            if val.starts_with('>') || val.is_empty() {
                // Multi-line description — collect subsequent indented lines
                continue;
            }
            desc = val.trim_matches('"').trim_matches('\'').to_string();
        } else if !desc.is_empty() || line.starts_with('-') {
            // skip
        } else if desc.is_empty() && (line.starts_with(' ') || line.starts_with('\t')) {
            // continuation of multi-line description
            desc.push(' ');
            desc.push_str(line.trim());
        }
    }
    (name, desc.trim().to_string())
}

/// Import a discovered skill: convert to EchoMind format and save.
#[tauri::command]
pub async fn import_external_skill(
    state: State<'_, AppCore>,
    name: String,
    content: String,
) -> Result<(), String> {
    // Check if the content already has our trigger field — if not, add it
    let final_content = if content.contains("trigger:") {
        content
    } else {
        // Re-wrap: inject `trigger: both` into the frontmatter
        let trimmed = content.trim();
        if trimmed.starts_with("---") {
            let rest = &trimmed[3..];
            if let Some(end) = rest.find("\n---") {
                let yaml = &rest[..end];
                let body = rest[end + 4..].trim();
                format!("---\n{}trigger: both\n---\n\n{}", yaml.trim_end().to_string() + "\n", body)
            } else {
                // No closing ---, wrap the whole thing
                format!("---\nname: {}\ndescription: Imported skill\ntrigger: both\n---\n\n{}", name, content)
            }
        } else {
            // No frontmatter at all — create one
            format!("---\nname: {}\ndescription: Imported skill\ntrigger: both\n---\n\n{}", name, content)
        }
    };

    // Validate
    echomind_core::skills::parse_skill(&final_content)?;

    let filename = format!("{}.md", name.replace(' ', "-").to_lowercase());
    let path = state.0.skills_dir().join(&filename);
    std::fs::write(&path, &final_content).map_err(|e| format!("Failed to save: {e}"))
}
