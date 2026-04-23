import { useEffect, useState, useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ConversationWithPreview } from "../lib/types";
import { formatDistanceToNow } from "date-fns";
import { EchoMindLogo } from "./EchoMindLogo";

const navItems = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/search", icon: "search", label: "Search" },
  { to: "/graph", icon: "bubble_chart", label: "Graph" },
  { to: "/archive", icon: "inventory_2", label: "Archive" },
  { to: "/wechat", icon: "hub", label: "WeChat Bridge" },
  { to: "/cloud", icon: "cloud_sync", label: "Cloud Bridge" },
  { to: "/settings", icon: "settings", label: "Settings" },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [chatExpanded, setChatExpanded] = useState(false);
  const [sessions, setSessions] = useState<ConversationWithPreview[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isChatActive = location.pathname === "/chat" || location.pathname.includes("/chat");

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const list = await invoke<ConversationWithPreview[]>("list_recent_conversations");
      setSessions(list);
    } catch { /* ignore */ }
    finally { setLoadingSessions(false); }
  }, []);

  // Auto-expand when on chat page
  useEffect(() => {
    if (isChatActive && !chatExpanded) {
      setChatExpanded(true);
    }
  }, [isChatActive]);

  // Load sessions when expanded
  useEffect(() => {
    if (chatExpanded) loadSessions();
  }, [chatExpanded, loadSessions]);

  const handleChatClick = () => {
    if (chatExpanded && isChatActive) {
      setChatExpanded(false);
    } else {
      setChatExpanded(true);
      navigate("/chat");
    }
  };

  const filteredSessions = searchQuery
    ? sessions.filter((s) =>
        (s.title || s.thought_preview).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  return (
    <aside className="flex flex-col py-6 px-5 bg-surface w-64 shrink-0 overflow-hidden">
      {/* Logo */}
      <div className="mb-10 flex items-center gap-3">
        <EchoMindLogo className="w-8 h-8 text-primary" style={{ color: "var(--t-primary)" }} />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-bold tracking-widest text-primary font-headline">EchoMind</h1>
          <span className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60">
            Cognitive Sanctuary
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto no-scrollbar">
        {navItems.slice(0, 3).map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        {/* Chat - expandable */}
        <button
          onClick={handleChatClick}
          className={`flex items-center gap-4 py-3 px-4 rounded-lg transition-all w-full ${
            isChatActive
              ? "text-primary font-bold bg-surface-container-high border-r-2 border-primary"
              : "text-on-surface-variant/70 hover:bg-surface-container-high hover:text-on-surface"
          }`}
        >
          <span
            className="material-symbols-outlined"
            style={isChatActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            chat_bubble
          </span>
          <span className="text-sm flex-1 text-left">Chat</span>
          <span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${chatExpanded ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>

        {/* Chat sessions sub-list */}
        {chatExpanded && (
          <div className="ml-4 pl-3 pr-1 border-l border-outline-variant/15 py-1 min-w-0">
            {/* Search */}
            <div className="relative mb-1">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant/30 absolute left-2 top-1/2 -translate-y-1/2">search</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-surface-container-low rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>

            {/* Session list */}
            <div className="max-h-52 overflow-y-auto no-scrollbar space-y-0.5">
              {loadingSessions && (
                <div className="py-2 flex justify-center">
                  <span className="material-symbols-outlined text-[16px] text-primary animate-spin">progress_activity</span>
                </div>
              )}
              {!loadingSessions && filteredSessions.length === 0 && (
                <p className="text-[10px] text-on-surface-variant/40 py-2 px-2">
                  {searchQuery ? "No matches" : "No conversations yet"}
                </p>
              )}
              {filteredSessions.map((s) => {
                const preview = s.title || (s.thought_preview.length > 24 ? s.thought_preview.slice(0, 24) + "..." : s.thought_preview);
                const isActive = location.pathname === `/thought/${s.thought_id}/chat`;
                let timeAgo = "";
                try { timeAgo = formatDistanceToNow(new Date(s.updated_at), { addSuffix: false }); } catch { /* ignore */ }
                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/thought/${s.thought_id}/chat`)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all text-[11px] ${
                      isActive
                        ? "text-primary bg-primary/10 font-medium"
                        : "text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-high"
                    }`}
                    title={s.thought_preview}
                  >
                    <div className="truncate">{preview}</div>
                    <div className="text-[9px] text-on-surface-variant/40 font-mono mt-0.5">{timeAgo}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {navItems.slice(3).map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* New Inspiration CTA - bottom */}
      <button
        onClick={() => {
          navigate("/");
          setTimeout(() => {
            const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder]');
            el?.focus();
          }, 100);
        }}
        className="mt-4 flex items-center justify-center gap-3 luminous-pulse text-on-primary py-3 px-4 rounded-xl font-semibold shadow-xl active:scale-95 transition-all text-sm"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        <span>New Inspiration</span>
      </button>
    </aside>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-4 py-3 px-4 rounded-lg transition-all ${
          isActive
            ? "text-primary font-bold bg-surface-container-high border-r-2 border-primary"
            : "text-on-surface-variant/70 hover:bg-surface-container-high hover:text-on-surface"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="material-symbols-outlined"
            style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            {icon}
          </span>
          <span className="text-sm">{label}</span>
        </>
      )}
    </NavLink>
  );
}
