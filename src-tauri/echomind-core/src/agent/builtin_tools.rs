//! Built-in tools the agent can call. Each tool registers a JSON-Schema spec
//! plus an async handler that takes the EchoMind core and a JSON args object.

use std::sync::Arc;

use serde_json::{json, Value};

use super::{ToolFn, ToolFuture, ToolRegistry};
use crate::llm::Tool;
use crate::EchoMind;

/// Build a registry containing every built-in tool.
pub fn default_registry() -> ToolRegistry {
    let mut reg = ToolRegistry::new();

    reg.register(
        Tool {
            name: "search_thoughts".to_string(),
            description:
                "Semantic search across the user's thoughts. Use this whenever the user asks about \
                 their past notes, ideas, or anything they may have written before."
                    .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language query to semantically match against the user's thoughts."
                    }
                },
                "required": ["query"]
            }),
        },
        wrap(|core, args| Box::pin(async move {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing 'query' argument".to_string())?;
            let results = core.semantic_search(query).await?;
            let trimmed: Vec<Value> = results
                .into_iter()
                .take(8)
                .map(|t| {
                    json!({
                        "id": t.id,
                        "content": t.content,
                        "domain": t.domain,
                        "tags": t.tags,
                        "context": t.context,
                        "file_summary": t.file_summary,
                        "created_at": t.created_at,
                    })
                })
                .collect();
            Ok(json!({"results": trimmed}).to_string())
        })),
    );

    reg.register(
        Tool {
            name: "get_thought".to_string(),
            description: "Fetch a single thought by its id, including all metadata.".to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Thought id (UUID)."}
                },
                "required": ["id"]
            }),
        },
        wrap(|core, args| Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing 'id' argument".to_string())?;
            let t = core.get_thought(id)?;
            Ok(json!({
                "id": t.id,
                "content": t.content,
                "domain": t.domain,
                "tags": t.tags,
                "context": t.context,
                "file_summary": t.file_summary,
                "created_at": t.created_at,
            })
            .to_string())
        })),
    );

    reg.register(
        Tool {
            name: "list_recent_thoughts".to_string(),
            description: "List the most recently created thoughts. Use when the user asks about \
                          'my latest notes' or wants a recap."
                .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "How many to return (default 10).", "default": 10}
                }
            }),
        },
        wrap(|core, args| Box::pin(async move {
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10) as usize;
            let all = core.list_thoughts()?;
            let trimmed: Vec<Value> = all
                .into_iter()
                .take(limit)
                .map(|t| {
                    json!({
                        "id": t.id,
                        "content": t.content,
                        "domain": t.domain,
                        "tags": t.tags,
                        "created_at": t.created_at,
                    })
                })
                .collect();
            Ok(json!({"thoughts": trimmed}).to_string())
        })),
    );

    reg.register(
        Tool {
            name: "create_thought".to_string(),
            description: "Create a new thought (inspiration note) on behalf of the user. \
                          Only use this if the user explicitly asks to record something."
                .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The thought text to record."}
                },
                "required": ["content"]
            }),
        },
        wrap(|core, args| Box::pin(async move {
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing 'content' argument".to_string())?;
            let t = core.create_thought(content)?;
            Ok(json!({"id": t.id, "created_at": t.created_at}).to_string())
        })),
    );

    reg.register(
        Tool {
            name: "update_thought".to_string(),
            description: "Update the text content of an existing thought. Only use if the user \
                          asks to edit/rewrite a specific thought."
                .to_string(),
            parameters_schema: json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["id", "content"]
            }),
        },
        wrap(|core, args| Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing 'id' argument".to_string())?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing 'content' argument".to_string())?;
            let t = core.update_thought(id, content)?;
            Ok(json!({"id": t.id, "updated_at": t.updated_at}).to_string())
        })),
    );

    reg
}

/// Helper that boxes a closure into our `ToolFn` type.
/// The closure must return an already-boxed future to satisfy the HRTB lifetime.
fn wrap<F>(f: F) -> ToolFn
where
    F: for<'a> Fn(&'a EchoMind, Value) -> ToolFuture<'a> + Send + Sync + 'static,
{
    Arc::new(f)
}
