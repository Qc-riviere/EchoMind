//! Skill system: markdown files with YAML frontmatter that define reusable
//! prompt-template tools. Skills can be auto (agent picks them), manual (user
//! triggers from UI), or both.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent::{ToolRegistry, ToolFuture};
use crate::llm::Tool;

/// How a skill can be triggered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillTrigger {
    Auto,
    Manual,
    Both,
}

impl Default for SkillTrigger {
    fn default() -> Self {
        Self::Manual
    }
}

/// Parameter definition inside a skill's frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillParam {
    #[serde(rename = "type", default = "default_string_type")]
    pub param_type: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub default: Option<String>,
}

fn default_string_type() -> String {
    "string".to_string()
}

/// YAML frontmatter of a skill file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub trigger: SkillTrigger,
    #[serde(default)]
    pub parameters: std::collections::HashMap<String, SkillParam>,
}

/// A fully parsed skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub trigger: SkillTrigger,
    pub parameters: std::collections::HashMap<String, SkillParam>,
    /// The prompt template body (markdown after the frontmatter).
    pub body: String,
    /// Source file path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<PathBuf>,
}

/// Parse a single skill from markdown text with YAML frontmatter.
pub fn parse_skill(text: &str) -> Result<Skill, String> {
    let text = text.trim();
    if !text.starts_with("---") {
        return Err("Skill file must start with YAML frontmatter (---)".into());
    }
    let rest = &text[3..];
    let end = rest
        .find("\n---")
        .ok_or_else(|| "Missing closing --- for frontmatter".to_string())?;
    let yaml_str = &rest[..end];
    let body = rest[end + 4..].trim().to_string();

    let fm: SkillFrontmatter =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("Invalid frontmatter YAML: {e}"))?;

    // Sanitize parameter types — ensure they're valid JSON Schema types
    let mut parameters = fm.parameters;
    for param in parameters.values_mut() {
        match param.param_type.as_str() {
            "string" | "number" | "integer" | "boolean" | "object" | "array" => {}
            _ => { param.param_type = "string".to_string(); }
        }
    }

    Ok(Skill {
        name: fm.name,
        description: fm.description,
        trigger: fm.trigger,
        parameters,
        body,
        source_path: None,
    })
}

/// Load all `.md` skills from a directory.
pub fn load_skills_from_dir(dir: &Path) -> Vec<Skill> {
    let mut skills = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            match parse_skill(&text) {
                Ok(mut skill) => {
                    skill.source_path = Some(path);
                    skills.push(skill);
                }
                Err(e) => {
                    eprintln!("Skipping skill file {:?}: {}", path, e);
                }
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// Convert a skill into a `Tool` spec for the agent registry.
fn skill_to_tool_spec(skill: &Skill) -> Tool {
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();

    for (name, param) in &skill.parameters {
        let mut prop = serde_json::Map::new();
        prop.insert("type".into(), json!(param.param_type));
        if !param.description.is_empty() {
            prop.insert("description".into(), json!(param.description));
        }
        if let Some(def) = &param.default {
            prop.insert("default".into(), json!(def));
        }
        properties.insert(name.clone(), Value::Object(prop));
        if param.default.is_none() {
            required.push(json!(name));
        }
    }

    Tool {
        name: format!("skill_{}", skill.name),
        description: format!("[Skill] {}", skill.description),
        parameters_schema: json!({
            "type": "object",
            "properties": properties,
            "required": required,
        }),
    }
}

/// Render a skill body by substituting `{{param}}` placeholders.
fn render_body(body: &str, args: &Value) -> String {
    let mut result = body.to_string();
    if let Some(obj) = args.as_object() {
        for (key, val) in obj {
            let placeholder = format!("{{{{{}}}}}", key);
            let replacement = match val.as_str() {
                Some(s) => s.to_string(),
                None => val.to_string(),
            };
            result = result.replace(&placeholder, &replacement);
        }
    }
    result
}

/// Register all auto/both skills into a tool registry. The skill body is returned
/// as the tool result so the agent uses it as instructions.
pub fn register_skills(registry: &mut ToolRegistry, skills: &[Skill]) {
    for skill in skills {
        if skill.trigger == SkillTrigger::Manual {
            continue;
        }
        let spec = skill_to_tool_spec(skill);
        let body = skill.body.clone();
        let handler: crate::agent::ToolFn = std::sync::Arc::new(
            move |_core: &crate::EchoMind, args: Value| -> ToolFuture<'_> {
                let rendered = render_body(&body, &args);
                Box::pin(async move { Ok(rendered) })
            },
        );
        registry.register(spec, handler);
    }
}

/// Execute a manual skill: render its body with the given arguments.
/// Returns the rendered prompt text to be sent as a message.
pub fn execute_skill(skill: &Skill, args: &Value) -> String {
    render_body(&skill.body, args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill() {
        let md = r#"---
name: summarize
description: Summarize a thought
trigger: manual
parameters:
  format:
    type: string
    description: Output format
    default: bullets
---

Summarize into {{format}} format."#;

        let skill = parse_skill(md).unwrap();
        assert_eq!(skill.name, "summarize");
        assert_eq!(skill.trigger, SkillTrigger::Manual);
        assert!(skill.body.contains("{{format}}"));
    }

    #[test]
    fn test_render_body() {
        let body = "Hello {{name}}, your topic is {{topic}}.";
        let args = json!({"name": "Alice", "topic": "AI"});
        let result = render_body(body, &args);
        assert_eq!(result, "Hello Alice, your topic is AI.");
    }
}
