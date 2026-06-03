import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ConversationWithPreview } from "../lib/types";
import { formatDistanceToNow } from "date-fns";
import { EchoMindLogo } from "./EchoMindLogo";

interface NavItemDef {
  to: string;
  icon: string;
  labelKey: string;
  hintKey?: string;
}

const navItems: NavItemDef[] = [
  { to: "/", icon: "home", labelKey: "nav.home" },
  { to: "/search", icon: "search", labelKey: "nav.search" },
  { to: "/graph", icon: "bubble_chart", labelKey: "nav.graph" },
  { to: "/archive", icon: "inventory_2", labelKey: "nav.archive" },
  { to: "/wechat", icon: "hub", labelKey: "nav.wechat_bridge", hintKey: "sidebar.wechat_hint" },
  { to: "/cloud", icon: "cloud_sync", labelKey: "nav.cloud_bridge", hintKey: "sidebar.cloud_hint" },
  { to: "/settings", icon: "settings", labelKey: "nav.settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
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

  // Load sessions when expanded. Also re-fetch whenever pathname changes
  // while expanded — covers the "started a new chat / sent a message that
  // updated the latest preview" case so the sidebar doesn't go stale
  // (GitHub issue #6). pathname-change is cheap and predictable; explicit
  // events would be more elegant but require touching the chat store.
  useEffect(() => {
    if (chatExpanded) loadSessions();
  }, [chatExpanded, loadSessions, location.pathname]);

  // Also re-fetch when a chat message lands — `chatStore.sendMessage` doesn't
  // touch pathname, so without this the preview never refreshes mid-conv.
  useEffect(() => {
    if (!chatExpanded) return;
    const onChatChanged = () => loadSessions();
    window.addEventListener("echomind:chat-changed", onChatChanged);
    return () => window.removeEventListener("echomind:chat-changed", onChatChanged);
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
          <span className="text-[11px] uppercase tracking-[0.2em] text-on-surface-variant/60">
            {t("sidebar.tagline")}
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
          <span className="text-sm flex-1 text-left truncate">{t("nav.chat")}</span>
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
                placeholder={t("sidebar.search_chats_placeholder")}
                aria-label={t("sidebar.search_chats_aria")}
                className="w-full bg-surface-container-low rounded-lg pl-7 pr-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                <p className="text-xs text-on-surface-variant py-2 px-2">
                  {searchQuery ? t("sidebar.no_matching_chats") : t("sidebar.no_chats_yet")}
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
                    <div className="text-[11px] text-on-surface-variant/40 font-mono mt-0.5">{timeAgo}</div>
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
        className="mt-4 flex items-center justify-center gap-3 luminous-pulse text-on-primary py-3 px-4 rounded-xl font-semibold shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all text-sm"
        aria-label={t("sidebar.new_thought")}
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        <span>{t("sidebar.new_thought")}</span>
      </button>
    </aside>
  );
}

function NavItem({ to, icon, labelKey, hintKey }: NavItemDef) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={hintKey ? t(hintKey) : undefined}
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
            className="material-symbols-outlined shrink-0"
            style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            {icon}
          </span>
          <span className="text-sm truncate min-w-0">{t(labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
