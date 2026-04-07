export interface Thought {
  id: string;
  content: string;
  context: string | null;
  domain: string | null;
  tags: string | null;
  image_path: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  thought_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface StatusInfo {
  thoughts: number;
  archived: number;
  conversations: number;
}
