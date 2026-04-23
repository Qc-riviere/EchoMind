export interface Thought {
  id: string;
  content: string;
  context: string | null;
  domain: string | null;
  tags: string | null;
  image_path: string | null;
  file_summary: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateThoughtInput {
  content: string;
}

export interface UpdateThoughtInput {
  id: string;
  content: string;
}

export interface Conversation {
  id: string;
  thought_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationWithPreview {
  id: string;
  thought_id: string;
  title: string | null;
  thought_preview: string;
  created_at: string;
  updated_at: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  arguments?: unknown;
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  withdrawn?: boolean;
  tool_events?: ToolEvent[];
}

export type AgentEventPayload =
  | { kind: "text"; conversation_id: string; text: string }
  | { kind: "tool_call"; conversation_id: string; id: string; name: string; arguments: unknown }
  | { kind: "tool_result"; conversation_id: string; id: string; name: string; result: string }
  | { kind: "tool_error"; conversation_id: string; id: string; name: string; error: string }
  | { kind: "done"; conversation_id: string; text: string };

export interface StreamPayload {
  conversation_id: string;
  token: string;
  is_done: boolean;
}

export interface SkillParam {
  param_type: string;
  description: string;
  default?: string;
}

export interface Skill {
  name: string;
  description: string;
  trigger: "auto" | "manual" | "both";
  parameters: Record<string, SkillParam>;
  body: string;
}

export interface DiscoveredSkill {
  source: string;
  name: string;
  description: string;
  content: string;
  path: string;
}

export interface GraphNode {
  id: string;
  label: string;
  domain: string | null;
  tags: string | null;
  created_at: string;
  content_length: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
