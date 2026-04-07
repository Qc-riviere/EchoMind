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
  currentConversationId: string | null;

  startChat: (thoughtId: string) => Promise<Conversation>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  withdrawMessage: (messageId: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversation: null,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  error: null,
  currentConversationId: null,

  startChat: async (thoughtId: string) => {
    const conv = await invoke<Conversation>("start_chat", { thoughtId });
    set({ conversation: conv, messages: [], streamingContent: "", error: null, currentConversationId: conv.id });
    return conv;
  },

  loadMessages: async (conversationId: string) => {
    const msgs = await invoke<ChatMessage[]>("get_chat_messages", { conversationId });
    set({ messages: msgs });
  },

  sendMessage: async (conversationId: string, content: string) => {
    // Prevent concurrent messages for the same conversation
    if (get().isStreaming && get().currentConversationId === conversationId) {
      return;
    }

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
      currentConversationId: conversationId,
    });

    let unlistenFn: (() => void) | null = null;

    const unlisten = await listen<StreamPayload>("chat-stream", (event) => {
      const payload = event.payload;
      if (payload.conversation_id !== conversationId) return;

      if (payload.is_done) {
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
        unlistenFn?.();
      } else {
        set({ streamingContent: get().streamingContent + payload.token });
      }
    });
    unlistenFn = unlisten;

    try {
      await invoke("send_chat_message", { conversationId, content });
    } catch (e) {
      set({ error: String(e), isStreaming: false });
      unlisten();
    }
  },

  withdrawMessage: async (messageId: string) => {
    const msgs = get().messages;
    const msgIndex = msgs.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = msgs[msgIndex];
    if (msg.role !== "user") return;

    const newMessages = [...msgs];
    newMessages[msgIndex] = { ...msg, withdrawn: true, content: "[已撤回]" };
    set({ messages: newMessages });
  },

  reset: () => {
    set({
      conversation: null,
      messages: [],
      streamingContent: "",
      isStreaming: false,
      error: null,
      currentConversationId: null,
    });
  },
}));
