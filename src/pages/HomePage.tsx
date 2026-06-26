import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { errorMsg } from "../lib/errorMsg";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ThoughtInput from "../components/ThoughtInput";
import ThoughtList from "../components/ThoughtList";
import ApiKeyGuide from "../components/ApiKeyGuide";
import ThoughtDrawer from "../components/ThoughtDrawer";
import SelectionBar from "../components/SelectionBar";
import SummaryModal from "../components/SummaryModal";
import { notify } from "../lib/notify";
import type { Thought } from "../lib/types";
import { formatDistanceToNow } from "date-fns";

interface HomeThoughts {
  recent: Thought[];
  hot: Thought[];
  pinned: Thought[];
}

const PER_PAGE = 9;

export default function HomePage() {
  const { t } = useTranslation();
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
  const [home, setHome] = useState<HomeThoughts>({ recent: [], hot: [], pinned: [] });
  const [allThoughts, setAllThoughts] = useState<Thought[]>([]);
  const [page, setPage] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  const loadHome = useCallback(async () => {
    try {
      const [home, all] = await Promise.all([
        invoke<HomeThoughts>("list_home_thoughts"),
        invoke<Thought[]>("list_thoughts"),
      ]);
      setHome(home);
      setAllThoughts(all);
    } catch { /* ignore; bottom-level lists handle their own errors */ }
  }, []);

  useEffect(() => {
    loadHome();
    const t = setInterval(loadHome, 30000);
    let unlisten: UnlistenFn | null = null;
    listen("thought:created", () => {
      setPage(0);
      loadHome();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      clearInterval(t);
      unlisten?.();
    };
  }, [loadHome]);

  // Exclude pinned from the paginated list (they're already shown in their own
  // section above) so the user doesn't see them twice.
  const pinnedIds = useMemo(() => new Set(home.pinned.map((t) => t.id)), [home.pinned]);
  const mainList = useMemo(
    () => (pinnedIds.size ? allThoughts.filter((t) => !pinnedIds.has(t.id)) : allThoughts),
    [allThoughts, pinnedIds],
  );
  const totalPages = Math.max(1, Math.ceil(mainList.length / PER_PAGE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pagedThoughts = useMemo(
    () => mainList.slice(pageSafe * PER_PAGE, pageSafe * PER_PAGE + PER_PAGE),
    [mainList, pageSafe],
  );

  const allDisplayed = useMemo(() => {
    const map = new Map<string, Thought>();
    [...home.pinned, ...allThoughts, ...home.hot].forEach((t) => map.set(t.id, t));
    return map;
  }, [home, allThoughts]);

  const listSectionRef = useRef<HTMLElement>(null);
  const skipScrollRef = useRef(true);
  useEffect(() => {
    // Skip the initial render and the scroll-after-new-thought reset
    // (already handled by being on page 1 = top of list).
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    listSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageSafe]);

  const selectedThoughts = useMemo(
    () => Array.from(selectedIds).map((id) => allDisplayed.get(id)).filter(Boolean) as Thought[],
    [selectedIds, allDisplayed],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const cancelSelect = () => setSelectedIds(new Set());

  const handleSummarize = async () => {
    if (selectedIds.size < 2) return;
    setSummaryOpen(true);
    setSummarizing(true);
    setSummaryText("");
    try {
      const result = await invoke<string>("summarize_thoughts", { ids: Array.from(selectedIds) });
      setSummaryText(result);
      notify("EchoMind", t("home.summary_done")).catch(() => {});
    } catch (e) {
      setSummaryText(t("home.summary_failed", { msg: errorMsg(e) }));
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      <ThoughtInput onCaptured={loadHome} />
      <ApiKeyGuide />

      <div className="grid grid-cols-12 gap-12">
        {/* Inspiration Feed */}
        <div className="col-span-12 lg:col-span-8 space-y-12">
          {home.pinned.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-headline font-bold uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] rotate-45">push_pin</span>
                  {t("home.most_important")}
                </h3>
              </div>
              <PinnedSection
                pinned={home.pinned}
                activeThoughtId={selectedThought?.id}
                selectedIds={selectedIds}
                onThoughtClick={setSelectedThought}
                onToggleSelect={toggleSelect}
                onChanged={loadHome}
              />
            </section>
          )}

          <section ref={listSectionRef} className="scroll-mt-6">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-headline font-bold text-on-surface">{t("home.all_thoughts")}</h3>
              <span className="text-xs text-on-surface-variant/50 font-mono">
                {mainList.length === 0
                  ? t("home.count_zero")
                  : `${pageSafe * PER_PAGE + 1}–${Math.min((pageSafe + 1) * PER_PAGE, mainList.length)} / ${mainList.length}`}
              </span>
            </div>
            <ThoughtList
              thoughts={pagedThoughts}
              onThoughtClick={(thought) => setSelectedThought(thought)}
              activeThoughtId={selectedThought?.id}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onChanged={loadHome}
            />

            {totalPages > 1 && (
              <nav
                className="flex items-center justify-center gap-2 mt-8"
                aria-label={t("home.pagination_aria")}
              >
                <button
                  onClick={() => setPage(Math.max(0, pageSafe - 1))}
                  disabled={pageSafe === 0}
                  className="min-w-[40px] h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t("home.prev_page")}
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    aria-label={t("home.page_x_of_y", { current: i + 1, total: totalPages })}
                    aria-current={i === pageSafe ? "page" : undefined}
                    className={`min-w-[40px] h-10 px-3 rounded-full text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors ${
                      i === pageSafe
                        ? "bg-primary text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, pageSafe + 1))}
                  disabled={pageSafe >= totalPages - 1}
                  className="min-w-[40px] h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t("home.next_page")}
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
              </nav>
            )}
          </section>

        </div>

        {/* Right Discovery Panel */}
        <aside className="col-span-12 lg:col-span-4 flex flex-col gap-8">
          <HotChats thoughts={home.hot} />

          {/* Cognitive Discovery */}
          <CognitiveDiscovery />

          {/* Random Revisit */}
          <RandomRevisit onSelect={(t) => setSelectedThought(t)} />
        </aside>
      </div>

      <ThoughtDrawer
        thought={selectedThought}
        onClose={() => setSelectedThought(null)}
      />

      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          onSummarize={handleSummarize}
          onCancel={cancelSelect}
          busy={summarizing}
        />
      )}

      <SummaryModal
        isOpen={summaryOpen}
        thoughts={selectedThoughts}
        summary={summaryText}
        loading={summarizing}
        onClose={() => setSummaryOpen(false)}
        onSavedAsThought={() => {
          cancelSelect();
          loadHome();
        }}
      />
    </div>
  );
}

interface PinnedSectionProps {
  pinned: Thought[];
  activeThoughtId?: string;
  selectedIds: Set<string>;
  onThoughtClick: (t: Thought) => void;
  onToggleSelect: (id: string) => void;
  onChanged: () => void;
}

// Renders the pinned thoughts as a manually-orderable list. Only the grip
// handle is a drag source, so card text stays selectable and buttons clickable.
// During a drag the list live-reorders so the other cards "make room"; a FLIP
// animation makes that shift smooth (squeeze). Order is persisted on drop.
function PinnedSection({
  pinned,
  activeThoughtId,
  selectedIds,
  onThoughtClick,
  onToggleSelect,
  onChanged,
}: PinnedSectionProps) {
  const [order, setOrder] = useState<Thought[]>(pinned);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  // Card DOM nodes + their last-painted top, keyed by thought id. Used to FLIP-
  // animate cards into their new slot whenever `order` changes.
  const cardEls = useRef<Map<string, HTMLElement>>(new Map());
  const prevTops = useRef<Map<string, number>>(new Map());

  // Resync when the backend list changes (new pin / unpin / external sync).
  useEffect(() => { setOrder(pinned); }, [pinned]);

  useLayoutEffect(() => {
    cardEls.current.forEach((el, id) => {
      const newTop = el.getBoundingClientRect().top;
      const oldTop = prevTops.current.get(id);
      if (oldTop != null && oldTop !== newTop) {
        // Invert: jump back to the old position, then transition to natural (0).
        el.style.transition = "none";
        el.style.transform = `translateY(${oldTop - newTop}px)`;
        el.getBoundingClientRect(); // force reflow so the next frame animates
        el.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
        el.style.transform = "";
      }
      prevTops.current.set(id, newTop);
    });
  }, [order]);

  // Live reorder: move the dragged card to the hovered slot. Guarded so it only
  // fires when the position actually changes (dragOver streams continuously).
  const moveOver = (targetId: string) => {
    const from = draggingId;
    if (!from || from === targetId) return;
    setOrder((cur) => {
      const fi = cur.findIndex((t) => t.id === from);
      const ti = cur.findIndex((t) => t.id === targetId);
      if (fi < 0 || ti < 0 || fi === ti) return cur;
      const next = [...cur];
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  const finishDrag = () => {
    setDraggingId(null);
    invoke("reorder_pinned_thoughts", { ids: orderRef.current.map((t) => t.id) })
      .then(() => onChanged())
      .catch(() => { /* revert on next loadHome */ });
  };

  return (
    <div className="space-y-4">
      {order.map((thought) => (
        <div
          key={thought.id}
          data-pin-card
          ref={(el) => {
            if (el) cardEls.current.set(thought.id, el);
            else cardEls.current.delete(thought.id);
          }}
          onDragOver={(e) => { e.preventDefault(); moveOver(thought.id); }}
          onDrop={(e) => e.preventDefault()}
          className={`relative flex items-start gap-1 ring-1 ring-primary/30 rounded-2xl pt-2 px-2 pb-4 ${
            draggingId === thought.id ? "opacity-40 blur-[2px]" : ""
          }`}
        >
          {order.length > 1 && (
            <span
              draggable
              onDragStart={(e) => {
                setDraggingId(thought.id);
                // WebView2/Safari won't start a drag unless dataTransfer carries
                // something; set a payload + move effect to make it reliable.
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", thought.id);
                // Drag the whole card (not just the grip) under the cursor.
                const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-pin-card]");
                if (card) {
                  const rect = card.getBoundingClientRect();
                  e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top);
                }
              }}
              onDragEnd={finishDrag}
              className="material-symbols-outlined text-[18px] text-on-surface-variant/40 hover:text-primary cursor-grab active:cursor-grabbing mt-6 ml-2 select-none flex-shrink-0"
              aria-label="drag to reorder"
            >
              drag_indicator
            </span>
          )}
          <div className="flex-1 min-w-0">
            <ThoughtList
              thoughts={[thought]}
              onThoughtClick={onThoughtClick}
              activeThoughtId={activeThoughtId}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onChanged={onChanged}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function HotChats({ thoughts }: { thoughts: Thought[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="p-6 bg-surface-container-high rounded-2xl ghost-border">
      <div className="flex items-center gap-3 mb-4">
        <span className="material-symbols-outlined text-primary">forum</span>
        <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">
          {t("home.most_chatted")}
        </h3>
      </div>

      {thoughts.length === 0 ? (
        <div className="text-center py-6">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">chat_bubble</span>
          <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
            {t("home.no_chats_yet")}
            <br />
            {t("home.no_chats_hint")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {thoughts.map((t, i) => (
            <li key={t.id}>
              <button
                onClick={() => navigate(`/thought/${t.id}/chat`)}
                className="w-full text-left rounded-xl px-3 py-2.5 bg-surface-container-low hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-mono text-on-surface-variant/70 mt-0.5 w-4 flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface line-clamp-2 leading-relaxed group-hover:text-primary transition-colors">
                      {t.file_summary || t.content}
                    </p>
                    {t.domain && (
                      <span className="inline-block mt-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wider">
                        {t.domain}
                      </span>
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[18px] text-on-surface-variant/50 group-hover:text-primary transition-colors flex-shrink-0">
                    chevron_right
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ThemeCluster {
  name: string;
  count: number;
  tags: string[];
  icon: string;
}

const DOMAIN_ICONS: Record<string, string> = {
  technology: "memory",
  science: "science",
  design: "palette",
  business: "trending_up",
  personal: "person",
  creative: "brush",
  philosophy: "psychology",
  health: "favorite",
  education: "school",
  finance: "payments",
};

function CognitiveDiscovery() {
  const { t } = useTranslation();
  const [clusters, setClusters] = useState<ThemeCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalThoughts, setTotalThoughts] = useState(0);

  useEffect(() => {
    invoke<Thought[]>("list_thoughts").then((thoughts) => {
      setTotalThoughts(thoughts.length);

      // Group by domain
      const domainMap = new Map<string, { count: number; tags: Set<string> }>();
      for (const t of thoughts) {
        const domain = t.domain?.trim().toLowerCase();
        if (!domain) continue;

        if (!domainMap.has(domain)) {
          domainMap.set(domain, { count: 0, tags: new Set() });
        }
        const entry = domainMap.get(domain)!;
        entry.count++;

        if (t.tags) {
          for (const tag of t.tags.split(",")) {
            const trimmed = tag.trim();
            if (trimmed) entry.tags.add(trimmed);
          }
        }
      }

      // Sort by count, take top 5
      const sorted = [...domainMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([name, data]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          count: data.count,
          tags: [...data.tags].slice(0, 4),
          icon: DOMAIN_ICONS[name] || "category",
        }));

      setClusters(sorted);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 bg-surface-container-high rounded-2xl ghost-border">
      <div className="flex items-center gap-3 mb-4">
        <span className="material-symbols-outlined text-primary">insights</span>
        <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">
          {t("home.topic_clusters")}
        </h3>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
        </div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-6">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">explore</span>
          <p className="text-xs text-on-surface-variant mt-2">
            {t("home.clusters_empty")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-on-surface-variant leading-relaxed mb-5">
            {t("home.clusters_summary", { thoughts: totalThoughts, clusters: clusters.length })}
          </p>

          <div className="space-y-3">
            {clusters.map((cluster) => (
              <div key={cluster.name} className="group">
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="material-symbols-outlined text-[18px] text-primary/70">{cluster.icon}</span>
                  <span className="text-xs font-semibold text-on-surface flex-1">{cluster.name}</span>
                  <span className="text-xs text-on-surface-variant font-mono">{cluster.count}</span>
                </div>

                {/* Progress bar */}
                <div className="ml-[30px] h-1 rounded-full bg-surface-container-lowest overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-full bg-primary/40 transition-all"
                    style={{ width: `${Math.min(100, (cluster.count / totalThoughts) * 100)}%` }}
                  />
                </div>

                {/* Tags */}
                {cluster.tags.length > 0 && (
                  <div className="ml-[30px] flex flex-wrap gap-1">
                    {cluster.tags.map((tag) => (
                      <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RandomRevisit({ onSelect }: { onSelect: (t: Thought) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [thought, setThought] = useState<Thought | null>(null);
  const [allThoughts, setAllThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);

  const pickRandom = useCallback((list: Thought[]) => {
    if (list.length === 0) return;
    const idx = Math.floor(Math.random() * list.length);
    setThought(list[idx]);
  }, []);

  useEffect(() => {
    invoke<Thought[]>("list_thoughts").then((list) => {
      setAllThoughts(list);
      pickRandom(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pickRandom]);

  if (loading) {
    return (
      <div className="p-8 rounded-2xl bg-gradient-to-br from-primary-container/20 to-transparent ghost-border">
        <div className="flex justify-center py-4">
          <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
        </div>
      </div>
    );
  }

  if (allThoughts.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-gradient-to-br from-primary-container/20 to-transparent ghost-border">
        <div className="flex items-center gap-3 mb-3">
          <span className="material-symbols-outlined text-primary">casino</span>
          <h4 className="text-sm font-headline font-bold text-on-surface">{t("home.random_review")}</h4>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          {t("home.review_empty")}
        </p>
      </div>
    );
  }

  let timeAgo = "";
  try {
    if (thought) timeAgo = formatDistanceToNow(new Date(thought.created_at), { addSuffix: true });
  } catch { /* ignore */ }

  return (
    <div className="p-6 rounded-2xl bg-gradient-to-br from-primary-container/20 to-transparent ghost-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">casino</span>
          <h4 className="text-sm font-headline font-bold text-on-surface">{t("home.random_review")}</h4>
        </div>
        <button
          onClick={() => pickRandom(allThoughts)}
          className="min-w-[40px] h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
          aria-label={t("home.shuffle")}
          title={t("home.shuffle")}
        >
          <span className="material-symbols-outlined text-[20px]">refresh</span>
        </button>
      </div>

      {thought && (
        <button
          onClick={() => onSelect(thought)}
          className="w-full text-left group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <p className="text-sm text-on-surface leading-relaxed line-clamp-3 group-hover:text-primary transition-colors">
            {thought.content}
          </p>
          <div className="flex items-center gap-2 mt-3">
            {thought.domain && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {thought.domain}
              </span>
            )}
            <span className="text-[11px] text-on-surface-variant font-mono">{timeAgo}</span>
          </div>
        </button>
      )}

      {thought && (
        <button
          onClick={() => navigate(`/thought/${thought.id}/chat`)}
          className="mt-4 w-full h-10 bg-surface-container-high hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary text-on-surface rounded-lg text-xs font-bold tracking-widest active:scale-95 transition-all ghost-border"
        >
          {t("home.revisit")}
        </button>
      )}
    </div>
  );
}
