import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Send, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import type { Thought } from "../lib/types";

export default function ChatPage() {
  const { thoughtId } = useParams<{ thoughtId: string }>();
  const navigate = useNavigate();
  const [thought, setThought] = useState<Thought | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentInitialRef = useRef(false);

  const {
    conversation,
    messages,
    streamingContent,
    isStreaming,
    error,
    startChat,
    loadMessages,
    sendMessage,
    withdrawMessage,
    reset,
  } = useChatStore();

  // Load thought and start/resume conversation
  useEffect(() => {
    if (!thoughtId) return;

    // Reset the ref when thoughtId changes
    hasSentInitialRef.current = false;
    reset();
    
    invoke<Thought>("get_thought", { id: thoughtId })
      .then(setThought)
      .catch(() => navigate("/"));

    startChat(thoughtId).then(async (conv) => {
      // Load existing messages
      await loadMessages(conv.id);
      const msgs = useChatStore.getState().messages;
      // Only send initial prompt if this is a brand new conversation and we haven't sent it yet
      if (msgs.length === 0 && !hasSentInitialRef.current) {
        hasSentInitialRef.current = true;
        sendMessage(conv.id, "请开始拷问这个灵感，帮我想清楚。");
      }
    });
  }, [thoughtId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming || !conversation) return;
    sendMessage(conversation.id, text);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-[#e3e1ed]/50">
        <button
          onClick={() => navigate("/")}
          className="text-[#a1a1aa] hover:text-[#575b8c] p-2 rounded-xl hover:bg-white/60 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#575b8c]" />
            <h1 className="text-lg font-bold text-[#575b8c] font-[Manrope] truncate">
              深度拷问
            </h1>
          </div>
          {thought && (
            <p className="text-sm text-[#7a7a84] truncate mt-0.5 font-medium">
              {thought.content}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto py-6 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="group relative">
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-3.5 transition-all duration-200 ${
                  msg.role === "user"
                    ? msg.withdrawn
                      ? "bg-[#a1a1aa]/30 text-[#7a7a84] italic"
                      : "bg-[#575b8c] text-white shadow-lg shadow-[#575b8c]/20"
                    : "bg-white/80 backdrop-blur-sm text-[#31323b] shadow-[0_4px_20px_rgba(87,91,140,0.08)] border border-white/60"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed text-sm">{msg.content}</p>
              </div>
              {msg.role === "user" && !msg.withdrawn && (
                <button
                  onClick={() => withdrawMessage(msg.id)}
                  className="absolute -left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-white rounded-full shadow-md hover:bg-[#f5f5f5]"
                  title="撤回"
                >
                  <Undo2 className="w-3.5 h-3.5 text-[#7a7a84]" />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-5 py-3.5 bg-white/80 backdrop-blur-sm text-[#31323b] shadow-[0_4px_20px_rgba(87,91,140,0.08)] border border-white/60">
              <p className="whitespace-pre-wrap leading-relaxed text-sm">{streamingContent}</p>
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-5 py-3.5 bg-white/80 backdrop-blur-sm shadow-[0_4px_20px_rgba(87,91,140,0.08)] border border-white/60">
              <Loader2 className="w-4 h-4 text-[#575b8c] animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-[#a8364b] bg-[#f97386]/10 rounded-2xl p-4 border border-[#f97386]/20">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="pt-4 border-t border-[#e3e1ed]/50">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#c1c5fd] to-[#575b8c] rounded-2xl blur opacity-10 group-focus-within:opacity-20 transition duration-500"></div>
          <div className="relative flex items-center bg-white/90 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 focus-within:ring-2 focus-within:ring-[#575b8c]/20 transition-all duration-300">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(); }}
              placeholder="回答 AI 的问题..."
              className="flex-1 bg-transparent px-5 py-4 text-[#31323b] placeholder-[#a1a1aa] focus:outline-none transition-colors resize-none min-h-[24px] max-h-[200px] overflow-y-auto"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isStreaming}
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="bg-[#575b8c] hover:bg-[#434670] disabled:opacity-50 disabled:hover:bg-[#575b8c] text-white px-5 py-3 mr-2 rounded-xl transition-all duration-200 active:scale-95 shadow-md shadow-[#575b8c]/20 flex items-center gap-2 font-medium"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
