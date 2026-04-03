import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, Conversation, StreamPayload } from "../lib/types";

interface ChatStore {
  conversation: Conversation | null;
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  error: string | null;

  startChat: (thoughtId: string) => Promise<Conversation>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversation: null,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  error: null,

  startChat: async (thoughtId: string) => {
    const conv = await invoke<Conversation>("start_chat", { thoughtId });
    set({ conversation: conv, messages: [], streamingContent: "", error: null });
    return conv;
  },

  loadMessages: async (conversationId: string) => {
    const msgs = await invoke<ChatMessage[]>("get_chat_messages", { conversationId });
    set({ messages: msgs });
  },

  sendMessage: async (conversationId: string, content: string) => {
    // Add user message to UI immediately
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    set({
      messages: [...get().messages, userMsg],
      streamingContent: "",
      isStreaming: true,
      error: null,
    });

    // Listen for stream events
    const unlisten = await listen<StreamPayload>("chat-stream", (event) => {
      const payload = event.payload;
      if (payload.conversation_id !== conversationId) return;

      if (payload.is_done) {
        // Finalize: move streaming content to a proper message
        const finalContent = get().streamingContent;
        if (finalContent) {
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            role: "assistant",
            content: finalContent,
            created_at: new Date().toISOString(),
          };
          set({
            messages: [...get().messages, assistantMsg],
            streamingContent: "",
            isStreaming: false,
          });
        } else {
          set({ isStreaming: false });
        }
        unlisten();
      } else {
        set({ streamingContent: get().streamingContent + payload.token });
      }
    });

    // Trigger the backend to start streaming
    try {
      await invoke("send_chat_message", { conversationId, content });
    } catch (e) {
      set({ error: String(e), isStreaming: false });
      unlisten();
    }
  },

  reset: () => {
    set({
      conversation: null,
      messages: [],
      streamingContent: "",
      isStreaming: false,
      error: null,
    });
  },
}));
