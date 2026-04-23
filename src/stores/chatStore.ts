import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentEventPayload,
  ChatMessage,
  Conversation,
  ToolEvent,
} from "../lib/types";

interface ChatStore {
  conversation: Conversation | null;
  messages: ChatMessage[];
  streamingContent: string;
  streamingToolEvents: ToolEvent[];
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
  streamingToolEvents: [],
  isStreaming: false,
  error: null,
  currentConversationId: null,

  startChat: async (thoughtId: string) => {
    const conv = await invoke<Conversation>("start_chat", { thoughtId });
    set({
      conversation: conv,
      messages: [],
      streamingContent: "",
      streamingToolEvents: [],
      error: null,
      currentConversationId: conv.id,
    });
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
      streamingToolEvents: [],
      isStreaming: true,
      error: null,
      currentConversationId: conversationId,
    });

    const finishStreaming = (finalText: string) => {
      const events = get().streamingToolEvents;
      const text = finalText || get().streamingContent;
      if (text || events.length > 0) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: "assistant",
          content: text,
          created_at: new Date().toISOString(),
          tool_events: events.length > 0 ? events : undefined,
        };
        set({
          messages: [...get().messages, assistantMsg],
          streamingContent: "",
          streamingToolEvents: [],
          isStreaming: false,
        });
      } else {
        set({ isStreaming: false, streamingToolEvents: [] });
      }
    };

    let unlistenAgent: (() => void) | null = null;

    unlistenAgent = await listen<AgentEventPayload>("chat-agent", (event) => {
      const payload = event.payload;
      if (payload.conversation_id !== conversationId) return;

      switch (payload.kind) {
        case "text": {
          set({ streamingContent: get().streamingContent + payload.text });
          break;
        }
        case "tool_call": {
          set({
            streamingToolEvents: [
              ...get().streamingToolEvents,
              { id: payload.id, name: payload.name, arguments: payload.arguments },
            ],
          });
          break;
        }
        case "tool_result": {
          set({
            streamingToolEvents: get().streamingToolEvents.map((e) =>
              e.id === payload.id ? { ...e, result: payload.result } : e
            ),
          });
          break;
        }
        case "tool_error": {
          set({
            streamingToolEvents: get().streamingToolEvents.map((e) =>
              e.id === payload.id ? { ...e, error: payload.error } : e
            ),
          });
          break;
        }
        case "done": {
          finishStreaming(payload.text);
          unlistenAgent?.();
          break;
        }
      }
    });

    try {
      await invoke("send_chat_message", { conversationId, content });
    } catch (e) {
      set({ error: String(e), isStreaming: false });
      unlistenAgent?.();
    }
  },

  withdrawMessage: async (messageId: string) => {
    const msgs = get().messages;
    const msgIndex = msgs.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = msgs[msgIndex];
    if (msg.role !== "user") return;

    try {
      const deletedIds = await invoke<string[]>("withdraw_message", { messageId });
      const deletedSet = new Set(deletedIds);
      set({ messages: msgs.filter((m) => !deletedSet.has(m.id)) });
    } catch (e) {
      console.error("Failed to withdraw message:", e);
    }
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
