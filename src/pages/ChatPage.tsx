import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../stores/chatStore";
import type { Thought } from "../lib/types";

const QUICK_CHIPS = [
  { label: "Market Demand", icon: "trending_up" },
  { label: "Competitive Analysis", icon: "swords" },
  { label: "Persona Deep Dive", icon: "group" },
  { label: "Risk Mitigation", icon: "shield" },
];

interface Resource {
  type: "article" | "tool" | "doc" | "concept";
  title: string;
  description: string;
  icon: string;
}

function generateResources(thought: Thought): Resource[] {
  const domain = (thought.domain || "").toLowerCase();
  const tags = (thought.tags || "").toLowerCase();
  const content = thought.content.toLowerCase();

  const resources: Resource[] = [];

  // Domain-based suggestions
  if (domain.includes("tech") || domain.includes("software") || content.includes("ai") || content.includes("code")) {
    resources.push(
      { type: "doc", title: "Technical Architecture Guide", description: "Best practices for system design and scalability patterns", icon: "architecture" },
      { type: "tool", title: "Developer Documentation", description: "API references and integration guides for your stack", icon: "terminal" },
    );
  }
  if (domain.includes("business") || content.includes("market") || content.includes("strategy") || tags.includes("business")) {
    resources.push(
      { type: "article", title: "Market Analysis Framework", description: "Structured approaches to evaluate market opportunities and competition", icon: "analytics" },
      { type: "concept", title: "Business Model Canvas", description: "Visual framework for developing and documenting business models", icon: "dashboard" },
    );
  }
  if (domain.includes("design") || content.includes("design") || content.includes("ui") || content.includes("ux")) {
    resources.push(
      { type: "article", title: "Design Systems Handbook", description: "Building consistent and scalable design language", icon: "palette" },
      { type: "tool", title: "UI Pattern Library", description: "Common interaction patterns and component guidelines", icon: "widgets" },
    );
  }
  if (domain.includes("creative") || domain.includes("art") || content.includes("music") || content.includes("创作")) {
    resources.push(
      { type: "concept", title: "Creative Process Models", description: "Frameworks for ideation, iteration, and creative breakthroughs", icon: "brush" },
      { type: "article", title: "Cross-Disciplinary Inspiration", description: "How ideas from adjacent fields spark innovation", icon: "hub" },
    );
  }
  if (domain.includes("product") || content.includes("product") || content.includes("feature") || content.includes("用户")) {
    resources.push(
      { type: "doc", title: "Product Requirements Template", description: "Structured approach to defining and prioritizing features", icon: "assignment" },
      { type: "concept", title: "Jobs To Be Done", description: "Understanding what users truly need beyond surface-level requests", icon: "person_search" },
    );
  }

  // Always add general-purpose resources
  if (resources.length === 0) {
    resources.push(
      { type: "concept", title: "First Principles Thinking", description: "Breaking down complex problems into fundamental truths", icon: "psychology" },
      { type: "article", title: "Mental Models Compendium", description: "Decision-making frameworks from multiple disciplines", icon: "model_training" },
    );
  }

  // Add a thought-specific resource
  resources.push(
    { type: "concept", title: "Thought Exploration Map", description: "Visualize the connections and implications of this idea", icon: "account_tree" },
  );

  return resources.slice(0, 5);
}

const TYPE_LABELS: Record<string, string> = {
  article: "Article",
  tool: "Tool",
  doc: "Documentation",
  concept: "Framework",
};

export default function ChatPage() {
  const { thoughtId } = useParams<{ thoughtId: string }>();
  const navigate = useNavigate();
  const [thought, setThought] = useState<Thought | null>(null);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentInitialRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    conversation, messages, streamingContent, isStreaming, error,
    startChat, loadMessages, sendMessage, withdrawMessage, reset,
  } = useChatStore();

  useEffect(() => {
    if (!thoughtId) return;
    hasSentInitialRef.current = false;
    reset();
    invoke<Thought>("get_thought", { id: thoughtId })
      .then(setThought)
      .catch(() => navigate("/"));
    startChat(thoughtId).then(async (conv) => {
      await loadMessages(conv.id);
      const msgs = useChatStore.getState().messages;
      if (msgs.length === 0 && !hasSentInitialRef.current) {
        hasSentInitialRef.current = true;
        sendMessage(conv.id, "请开始拷问这个灵感，帮我想清楚。");
      }
    });
  }, [thoughtId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming || !conversation) return;
    sendMessage(conversation.id, text);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, []);

  const resources = thought ? generateResources(thought) : [];

  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Scrollable message area */}
        <div className="flex-1 overflow-y-auto px-8 pt-6 space-y-8 pb-48 no-scrollbar">
          {/* Thought context header */}
          {thought && (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-start gap-3 mb-2">
                <span className="text-xs font-headline font-bold text-primary uppercase tracking-widest">对话</span>
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-2">
                {thought.file_summary || thought.content}
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="max-w-3xl ml-auto flex flex-col items-end">
                  <div className="group relative">
                    <div className={`p-5 rounded-2xl rounded-tr-none leading-relaxed max-w-xl ${
                      msg.withdrawn
                        ? "bg-surface-container-high text-on-surface-variant/50 italic"
                        : "bg-surface-container-high text-on-surface"
                    }`}>
                      <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                    </div>
                    {!msg.withdrawn && (
                      <button
                        onClick={() => withdrawMessage(msg.id)}
                        className="absolute -left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-surface-container-highest rounded-full"
                      >
                        <span className="material-symbols-outlined text-[14px] text-on-surface-variant">undo</span>
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-on-surface-variant mt-2 uppercase tracking-widest font-headline">User</span>
                </div>
              ) : (
                <div className="max-w-4xl mr-auto bg-gradient-to-br from-primary/5 to-primary-container/5 p-8 rounded-[2rem] border border-outline-variant/5">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
                    <span className="text-xs uppercase tracking-[0.3em] font-headline text-primary font-bold">EchoMind Logic Engine</span>
                  </div>
                  <div className="text-on-surface leading-loose">
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {streamingContent && (
            <div className="max-w-4xl mr-auto bg-gradient-to-br from-primary/5 to-primary-container/5 p-8 rounded-[2rem] border border-outline-variant/5">
              <div className="flex items-center gap-3 mb-5">
                <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
                <span className="text-xs uppercase tracking-[0.3em] font-headline text-primary font-bold">EchoMind Logic Engine</span>
              </div>
              <div className="text-on-surface leading-loose">
                <p className="whitespace-pre-wrap text-sm">{streamingContent}</p>
              </div>
            </div>
          )}

          {isStreaming && !streamingContent && (
            <div className="max-w-4xl mr-auto pl-4 opacity-60 flex items-center gap-4">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
              <span className="text-[10px] uppercase tracking-widest font-headline text-on-surface-variant">Synthesizing...</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-error bg-error-container/20 rounded-2xl p-4 ghost-border max-w-4xl">{error}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Floating input bar */}
        <div className="absolute bottom-6 left-0 right-0 px-8">
          <div className="max-w-4xl mx-auto glass-panel p-2 rounded-[1.5rem] shadow-2xl border border-outline-variant/10">
            <div className="flex items-end gap-3 p-2">
              <button className="p-3 text-outline hover:text-primary transition-all shrink-0">
                <span className="material-symbols-outlined text-[20px]">edit_note</span>
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                placeholder="Ask EchoMind to analyze deeply..."
                className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-outline/50 resize-none py-3 min-h-[24px] max-h-[200px] overflow-y-auto text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={isStreaming}
                rows={1}
              />
              <div className="flex items-center gap-2 shrink-0">
                <button className="p-3 text-outline hover:text-primary transition-all group relative">
                  <span className="material-symbols-outlined text-[20px]">history</span>
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-surface-container-high text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest whitespace-nowrap">Recall</span>
                </button>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="w-12 h-12 bg-primary-container text-on-primary-container rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                >
                  <span className="material-symbols-outlined">send</span>
                </button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 px-4 no-scrollbar">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => {
                    if (!isStreaming && conversation) {
                      sendMessage(conversation.id, chip.label);
                    }
                  }}
                  disabled={isStreaming}
                  className="whitespace-nowrap px-4 py-1.5 rounded-full border border-outline-variant/15 text-[11px] font-headline font-bold uppercase tracking-widest text-outline hover:text-primary hover:border-primary/30 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">{chip.icon}</span>
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Panel toggle button (when collapsed) */}
        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant/50 hover:text-primary transition-all ghost-border"
            title="Show resources"
          >
            <span className="material-symbols-outlined text-[20px]">menu_open</span>
          </button>
        )}
      </div>

      {/* Right panel - Contextual Resources */}
      {panelOpen && (
        <aside
          className="flex flex-col bg-surface-container-low border-l border-outline-variant/5 overflow-y-auto no-scrollbar shrink-0"
          style={{ width: 304 }}
        >
          <div className="p-6">
            {/* Header with collapse button */}
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-headline text-xs font-bold uppercase tracking-[0.3em] text-primary">
                Contextual Resources
              </h3>
              <button
                onClick={() => setPanelOpen(false)}
                className="p-1 rounded-md text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high transition-all"
                title="Collapse panel"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Thought info */}
            {thought && (
              <div className="mb-8 p-4 rounded-xl bg-surface-container ghost-border">
                <span className="text-[9px] text-primary/70 uppercase tracking-widest font-bold">
                  {thought.domain || "Inspiration"}
                </span>
                <p className="text-xs text-on-surface font-medium mt-1 line-clamp-2">{thought.content}</p>
                {thought.tags && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {thought.tags.split(",").slice(0, 4).map((tag) => (
                      <span key={tag.trim()} className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60">
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Resource cards */}
            <div className="space-y-3">
              {resources.map((res, i) => (
                <div
                  key={i}
                  className="group p-4 rounded-xl bg-surface-container hover:bg-surface-container-high transition-all cursor-pointer ghost-border"
                >
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-[20px] text-primary/60 group-hover:text-primary transition-colors mt-0.5">
                      {res.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] text-primary/50 uppercase tracking-widest font-bold">
                        {TYPE_LABELS[res.type]}
                      </span>
                      <h4 className="text-xs font-headline font-bold text-on-surface group-hover:text-primary transition-colors mt-0.5">
                        {res.title}
                      </h4>
                      <p className="text-[11px] text-on-surface-variant/60 mt-1 leading-relaxed line-clamp-2">
                        {res.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* AI suggestion */}
            {thought && (
              <div className="mt-8 p-5 rounded-2xl bg-primary-container/10 border border-primary/20">
                <span className="material-symbols-outlined text-[20px] text-primary mb-3 block">lightbulb</span>
                <p className="text-xs font-semibold text-primary leading-relaxed">
                  Ask EchoMind to recommend specific resources for deeper exploration of this topic.
                </p>
                <button
                  onClick={() => {
                    if (!isStreaming && conversation) {
                      sendMessage(conversation.id, "推荐一些与这个灵感相关的资源、文章、工具或框架，帮我深入探索。");
                    }
                  }}
                  disabled={isStreaming}
                  className="mt-4 text-[10px] font-bold uppercase tracking-widest text-on-surface hover:text-primary transition-colors disabled:opacity-50"
                >
                  Ask for Resources →
                </button>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
