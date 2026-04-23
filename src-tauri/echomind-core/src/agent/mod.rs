//! Agent loop with tool calling. Built-in tools live in `builtin_tools`.
//!
//! Usage: build a tool registry, then call `run_agent` with the conversation
//! messages. The loop sends messages to the LLM, executes any tool calls the
//! model emits, feeds results back, and stops when the model returns plain
//! text or `max_iter` is reached.

pub mod builtin_tools;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::llm::{
    get_provider, AgentMessage, AgentTurn, ModelConfig, ProviderType, Tool,
};
use crate::EchoMind;

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;
pub type ToolFn = Arc<
    dyn for<'a> Fn(&'a EchoMind, Value) -> ToolFuture<'a> + Send + Sync,
>;

pub struct ToolDef {
    pub spec: Tool,
    pub handler: ToolFn,
}

#[derive(Default)]
pub struct ToolRegistry {
    tools: Vec<ToolDef>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    pub fn register(&mut self, spec: Tool, handler: ToolFn) {
        self.tools.push(ToolDef { spec, handler });
    }

    pub fn specs(&self) -> Vec<Tool> {
        self.tools.iter().map(|t| t.spec.clone()).collect()
    }

    pub fn get(&self, name: &str) -> Option<&ToolDef> {
        self.tools.iter().find(|t| t.spec.name == name)
    }
}

/// Events emitted during an agent run, for the host to relay to the UI.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// Model produced an interim text chunk (between tool calls or as the final answer).
    Text(String),
    /// Model invoked a tool.
    ToolCall { id: String, name: String, arguments: Value },
    /// Tool finished and returned a result.
    ToolResult { id: String, name: String, result: String },
    /// Tool failed.
    ToolError { id: String, name: String, error: String },
    /// Final answer text.
    Final(String),
}

/// Run an agent loop until the model produces a final answer with no tool calls,
/// or `max_iter` iterations are exhausted. `on_event` is called for each event.
pub async fn run_agent<F>(
    core: &EchoMind,
    provider_type: ProviderType,
    config: &ModelConfig,
    registry: &ToolRegistry,
    initial_messages: Vec<AgentMessage>,
    max_iter: usize,
    mut on_event: F,
) -> Result<String, String>
where
    F: FnMut(AgentEvent),
{
    let provider = get_provider(provider_type);
    let mut messages = initial_messages;
    let tools = registry.specs();

    for _ in 0..max_iter {
        let turn: AgentTurn = provider
            .complete_with_tools(messages.clone(), tools.clone(), config)
            .await?;

        // Emit any text the model produced this turn.
        if !turn.text.is_empty() {
            on_event(AgentEvent::Text(turn.text.clone()));
        }

        // No tool calls → final answer.
        if turn.tool_calls.is_empty() {
            on_event(AgentEvent::Final(turn.text.clone()));
            return Ok(turn.text);
        }

        // Record assistant turn (with tool calls) into history.
        messages.push(AgentMessage::Assistant {
            content: turn.text.clone(),
            tool_calls: turn.tool_calls.clone(),
        });

        // Execute each tool, feed results back.
        for tc in &turn.tool_calls {
            on_event(AgentEvent::ToolCall {
                id: tc.id.clone(),
                name: tc.name.clone(),
                arguments: tc.arguments.clone(),
            });

            let result = match registry.get(&tc.name) {
                Some(def) => (def.handler)(core, tc.arguments.clone()).await,
                None => Err(format!("Unknown tool: {}", tc.name)),
            };

            match result {
                Ok(s) => {
                    on_event(AgentEvent::ToolResult {
                        id: tc.id.clone(),
                        name: tc.name.clone(),
                        result: s.clone(),
                    });
                    messages.push(AgentMessage::ToolResult {
                        tool_call_id: tc.id.clone(),
                        name: tc.name.clone(),
                        content: s,
                    });
                }
                Err(e) => {
                    on_event(AgentEvent::ToolError {
                        id: tc.id.clone(),
                        name: tc.name.clone(),
                        error: e.clone(),
                    });
                    messages.push(AgentMessage::ToolResult {
                        tool_call_id: tc.id.clone(),
                        name: tc.name.clone(),
                        content: json!({"error": e}).to_string(),
                    });
                }
            }
        }
    }

    Err(format!("Agent did not converge in {} iterations", max_iter))
}
