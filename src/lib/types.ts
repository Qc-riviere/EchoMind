export interface Thought {
  id: string;
  content: string;
  context: string | null;
  domain: string | null;
  tags: string | null;
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

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface StreamPayload {
  conversation_id: string;
  token: string;
  is_done: boolean;
}
