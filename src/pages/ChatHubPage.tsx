import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { useChatStore } from "../stores/chatStore";
import ConfirmDialog from "../components/ConfirmDialog";
import type { Thought, ToolEvent, Skill } from "../lib/types";

function ToolEventList({ events }: { events: ToolEvent[] }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="space-y-2 mb-4">
      {events.map((evt) => {
        const pending = evt.result === undefined && evt.error === undefined;
        const argsStr = (() => {
          try {
            const s = typeof evt.arguments === "string" ? evt.arguments : JSON.stringify(evt.arguments);
            return s && s.length > 120 ? s.slice(0, 120) + "…" : s;
          } catch {
            return "";
          }
        })();
        return (
          <div
            key={evt.id}
            className="text-[11px] rounded-lg px-3 py-2 bg-surface-container/60 ghost-border font-mono"
          >
            <div className="flex items-center gap-2">
              <span
                className={`material-symbols-outlined text-[14px] ${
                  evt.error ? "text-error" : pending ? "text-primary animate-pulse" : "text-primary/70"
                }`}
              >
                {evt.error ? "error" : pending ? "sync" : "check_circle"}
              </span>
              <span className="font-bold text-on-surface">{evt.name}</span>
              {argsStr && (
                <span className="text-on-surface-variant/60 truncate">({argsStr})</span>
              )}
            </div>
            {evt.error && (
              <div className="mt-1 text-error/80 whitespace-pre-wrap">{evt.error}</div>
            )}
            {evt.result && (
              <div className="mt-1 text-on-surface-variant/70 whitespace-pre-wrap line-clamp-3">
                {evt.result.length > 240 ? evt.result.slice(0, 240) + "…" : evt.result}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const QUICK_CHIPS = [
  { icon: "trending_up", label: "Market Demand" },
  { icon: "swords", label: "Competitive Analysis" },
  { icon: "group", label: "Persona Deep Dive" },
  { icon: "shield", label: "Risk Mitigation" },
];

interface Resource {
  title: string;
  url: string;
  type: string;
  description: string;
}

const TYPE_ICONS: Record<string, string> = {
  article: "article",
  tool: "handyman",
  doc: "description",
  project: "code",
  book: "menu_book",
  course: "school",
};

const TYPE_LABELS: Record<string, string> = {
  article: "文章",
  tool: "工具",
  doc: "文档",
  project: "项目",
  book: "书籍",
  course: "课程",
};

export default function ChatHubPage() {
  const { thoughtId } = useParams<{ thoughtId: string }>();
  const navigate = useNavigate();

  const [thought, setThought] = useState<Thought | null>(null);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasSentInitialRef = useRef(false);

  const {
    conversation, messages, streamingContent, streamingToolEvents, isStreaming, error,
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

  // Load skills
  useEffect(() => {
    invoke<Skill[]>("list_skills").then(setSkills).catch(() => {});
  }, []);

  const handleSkillPick = (skill: Skill) => {
    const tag = `/skill:${skill.name} `;
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart;
      const before = input.slice(0, start);
      const after = input.slice(start);
      setInput(before + tag + after);
      // Set cursor after the inserted tag
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + tag.length;
        el.focus();
      });
    } else {
      setInput((prev) => prev + tag);
    }
    setSkillMenuOpen(false);
  };

  // Load resources when thought is ready
  useEffect(() => {
    if (!thoughtId) return;
    setResources([]);
    setResourcesError(null);
    setResourcesLoading(true);
    invoke<Resource[]>("suggest_resources", { thoughtId })
      .then(setResources)
      .catch((e) => setResourcesError(String(e)))
      .finally(() => setResourcesLoading(false));
  }, [thoughtId]);

  const openUrl = (url: string) => {
    tauriOpenUrl(url).catch(() => {
      window.open(url, "_blank");
    });
  };

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

  const refreshResources = () => {
    if (!thoughtId || resourcesLoading) return;
    setResources([]);
    setResourcesError(null);
    setResourcesLoading(true);
    invoke<Resource[]>("suggest_resources", { thoughtId })
      .then(setResources)
      .catch((e) => setResourcesError(String(e)))
      .finally(() => setResourcesLoading(false));
  };

  // No thoughtId — empty state
  if (!thoughtId) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/20">forum</span>
          <h2 className="text-lg font-headline font-bold text-on-surface">Deep Questioning</h2>
          <p className="text-sm text-on-surface-variant/60 max-w-md">
            Select a conversation from the sidebar, or start a new one by clicking "Question" on any thought card.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-8 py-4 border-b border-outline-variant/10 shrink-0">
          <div className="flex-1 min-w-0">
            <h1 className="text-xs font-headline font-bold text-primary uppercase tracking-[0.2em]">
              Deep Questioning
            </h1>
            {thought && (
              <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                {thought.file_summary || thought.content}
              </p>
            )}
          </div>
          {/* Panel toggle in header */}
          {!panelOpen && (
            <button
              onClick={() => setPanelOpen(true)}
              className="p-2 rounded-lg text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high transition-all"
              title="Show resources"
            >
              <span className="material-symbols-outlined text-[20px]">right_panel_open</span>
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 pt-6 space-y-6 pb-44 no-scrollbar">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="ml-auto flex flex-col items-end group">
                  <div className={`p-5 rounded-2xl rounded-tr-none max-w-xl ${
                    msg.withdrawn
                      ? "bg-surface-container-high text-on-surface-variant/50 italic"
                      : "bg-surface-container-high text-on-surface"
                  }`}>
                    <p className="leading-relaxed text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {!msg.withdrawn && (
                    <button
                      onClick={() => setWithdrawTarget(msg.id)}
                      className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant/40 hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[14px]">undo</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="mr-auto bg-gradient-to-br from-primary/5 to-primary-container/5 p-8 rounded-[2rem] ghost-border">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] font-headline text-primary font-bold">
                      EchoMind Logic Engine
                    </span>
                  </div>
                  {msg.tool_events && <ToolEventList events={msg.tool_events} />}
                  <div className="text-on-surface leading-relaxed text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {(streamingContent || streamingToolEvents.length > 0) && (
            <div className="mr-auto bg-gradient-to-br from-primary/5 to-primary-container/5 p-8 rounded-[2rem] ghost-border">
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
                <span className="text-[10px] uppercase tracking-[0.3em] font-headline text-primary font-bold">
                  EchoMind Logic Engine
                </span>
              </div>
              <ToolEventList events={streamingToolEvents} />
              {streamingContent && (
                <div className="text-on-surface leading-relaxed text-sm whitespace-pre-wrap">
                  {streamingContent}
                </div>
              )}
            </div>
          )}

          {isStreaming && !streamingContent && streamingToolEvents.length === 0 && (
            <div className="mr-auto pl-4 opacity-60 flex items-center gap-4">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
              <span className="text-[10px] uppercase tracking-widest font-headline">Synthesizing...</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-error bg-error-container/20 rounded-2xl p-4 ghost-border">{error}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="absolute bottom-4 left-4 right-4">
          {/* Skill menu dropdown */}
          {skillMenuOpen && skills.length > 0 && (
            <div className="mb-2 glass-panel rounded-2xl ghost-border p-2 max-h-[240px] overflow-y-auto no-scrollbar">
              <div className="px-3 py-1.5 mb-1">
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40">Skills</span>
              </div>
              {skills
                .filter((s) => s.trigger === "manual" || s.trigger === "both")
                .map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => handleSkillPick(skill)}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-surface-container-high transition-all flex items-center gap-3 group"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary/50 group-hover:text-primary">bolt</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-on-surface">{skill.name}</p>
                      <p className="text-[10px] text-on-surface-variant/50 truncate">{skill.description}</p>
                    </div>
                  </button>
                ))}
            </div>
          )}

          <div className="glass-panel p-2 rounded-[1.5rem] ghost-border">
            <div className="flex items-end gap-3 p-2">
              <button
                onClick={() => setSkillMenuOpen(!skillMenuOpen)}
                className={`p-3 rounded-lg transition-all ${
                  skillMenuOpen
                    ? "text-primary bg-primary/10"
                    : "text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high"
                }`}
                title="Skills"
              >
                <span className="material-symbols-outlined">bolt</span>
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                placeholder="Ask EchoMind to analyze deeply..."
                className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-on-surface-variant/40 resize-none py-3 min-h-[24px] max-h-[200px] overflow-y-auto text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={isStreaming}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className="w-11 h-11 bg-primary text-on-primary rounded-xl flex items-center justify-center disabled:opacity-50 hover:brightness-110 active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 px-4 no-scrollbar">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => { if (!isStreaming && conversation) sendMessage(conversation.id, chip.label); }}
                  disabled={isStreaming}
                  className="whitespace-nowrap px-4 py-1.5 rounded-full ghost-border text-[10px] font-headline font-bold uppercase tracking-widest text-on-surface-variant/60 hover:text-primary hover:border-primary/30 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">{chip.icon}</span>
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - Contextual Resources */}
      {panelOpen && (
        <aside
          className="flex flex-col bg-surface-container-low border-l border-outline-variant/5 overflow-y-auto no-scrollbar shrink-0"
          style={{ width: 296 }}
        >
          <div className="p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">
                相关资源
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={refreshResources}
                  disabled={resourcesLoading}
                  className="p-1.5 rounded-md text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high transition-all disabled:opacity-30"
                  title="刷新资源"
                >
                  <span className={`material-symbols-outlined text-[16px] ${resourcesLoading ? "animate-spin" : ""}`}>refresh</span>
                </button>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="p-1.5 rounded-md text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high transition-all"
                  title="收起面板"
                >
                  <span className="material-symbols-outlined text-[16px]">right_panel_close</span>
                </button>
              </div>
            </div>

            {/* Loading state */}
            {resourcesLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-xl bg-surface-container ghost-border animate-pulse">
                    <div className="h-2 bg-on-surface/5 rounded w-1/3 mb-2" />
                    <div className="h-3 bg-on-surface/8 rounded w-full mb-2" />
                    <div className="h-2 bg-on-surface/5 rounded w-2/3" />
                  </div>
                ))}
                <p className="text-[10px] text-on-surface-variant/40 text-center mt-4">AI 正在分析并推荐资源...</p>
              </div>
            )}

            {/* Error state */}
            {resourcesError && !resourcesLoading && (
              <div className="p-4 rounded-xl bg-error-container/10 ghost-border text-center">
                <span className="material-symbols-outlined text-error/60 text-[24px] mb-2 block">cloud_off</span>
                <p className="text-xs text-on-surface-variant/60 mb-3">资源加载失败</p>
                <button
                  onClick={refreshResources}
                  className="text-[10px] font-bold text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            )}

            {/* Resource cards */}
            {!resourcesLoading && !resourcesError && resources.length > 0 && (
              <div className="space-y-2.5">
                {resources.map((res, i) => (
                  <button
                    key={i}
                    onClick={() => openUrl(res.url)}
                    className="w-full text-left group p-3.5 rounded-xl bg-surface-container hover:bg-surface-container-high transition-all ghost-border"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="material-symbols-outlined text-[18px] text-primary/50 group-hover:text-primary transition-colors mt-0.5">
                        {TYPE_ICONS[res.type] || "link"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] text-primary/50 uppercase tracking-widest font-bold">
                            {TYPE_LABELS[res.type] || res.type}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors mt-0.5 leading-snug">
                          {res.title}
                        </h4>
                        <p className="text-[10px] text-on-surface-variant/50 mt-1 leading-relaxed line-clamp-2">
                          {res.description}
                        </p>
                        <p className="text-[9px] text-primary/40 mt-1 truncate group-hover:text-primary/60 transition-colors">
                          {res.url}
                        </p>
                      </div>
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/20 group-hover:text-primary/60 transition-colors mt-1">
                        open_in_new
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!resourcesLoading && !resourcesError && resources.length === 0 && (
              <div className="text-center py-8">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant/15 mb-2 block">explore</span>
                <p className="text-xs text-on-surface-variant/40">暂无资源推荐</p>
              </div>
            )}
          </div>
        </aside>
      )}

      <ConfirmDialog
        isOpen={!!withdrawTarget}
        title="撤回消息"
        message="撤回后，该消息及其后续的 AI 回复将被永久删除，无法恢复。"
        confirmText="撤回"
        cancelText="取消"
        variant="warning"
        icon="warning"
        onConfirm={() => {
          if (withdrawTarget) withdrawMessage(withdrawTarget);
          setWithdrawTarget(null);
        }}
        onCancel={() => setWithdrawTarget(null)}
      />
    </div>
  );
}
