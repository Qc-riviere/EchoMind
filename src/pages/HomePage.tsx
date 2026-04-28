import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
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
}

export default function HomePage() {
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
  const [home, setHome] = useState<HomeThoughts>({ recent: [], hot: [] });

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  const loadHome = useCallback(async () => {
    try {
      const data = await invoke<HomeThoughts>("list_home_thoughts");
      setHome(data);
    } catch { /* ignore; bottom-level lists handle their own errors */ }
  }, []);

  useEffect(() => {
    loadHome();
    const t = setInterval(loadHome, 30000);
    return () => clearInterval(t);
  }, [loadHome]);

  const allDisplayed = useMemo(() => {
    const map = new Map<string, Thought>();
    [...home.recent, ...home.hot].forEach((t) => map.set(t.id, t));
    return map;
  }, [home]);

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

  const cancelSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleSummarize = async () => {
    if (selectedIds.size < 2) return;
    setSummaryOpen(true);
    setSummarizing(true);
    setSummaryText("");
    try {
      const result = await invoke<string>("summarize_thoughts", { ids: Array.from(selectedIds) });
      setSummaryText(result);
      notify("EchoMind", "AI 总结已完成").catch(() => {});
    } catch (e) {
      setSummaryText(`总结失败：${String(e)}`);
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
          <section>
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-headline font-bold text-on-surface">最近</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectMode((v) => !v)}
                  className={`flex items-center gap-1.5 text-xs uppercase tracking-wider transition-colors ${
                    selectMode ? "text-primary" : "text-on-surface-variant/60 hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {selectMode ? "check_box" : "check_box_outline_blank"}
                  </span>
                  {selectMode ? "退出多选" : "多选"}
                </button>
                <span className="text-xs text-on-surface-variant/50">最近 5 条</span>
              </div>
            </div>
            <ThoughtList
              thoughts={home.recent}
              onThoughtClick={(thought) => setSelectedThought(thought)}
              activeThoughtId={selectedThought?.id}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          </section>

          {home.hot.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-headline font-bold text-on-surface">对话最多</h3>
                <span className="text-xs text-on-surface-variant/50">高频回看</span>
              </div>
              <ThoughtList
                thoughts={home.hot}
                hideEmpty
                onThoughtClick={(thought) => setSelectedThought(thought)}
                activeThoughtId={selectedThought?.id}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            </section>
          )}
        </div>

        {/* Right Discovery Panel */}
        <aside className="col-span-12 lg:col-span-4 flex flex-col gap-8">
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

      {selectMode && selectedIds.size > 0 && (
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
          Cognitive Discovery
        </h3>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
        </div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-6">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/30">explore</span>
          <p className="text-[11px] text-on-surface-variant/50 mt-2">
            Record more thoughts to unlock AI discovery
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-on-surface-variant leading-relaxed mb-5">
            {totalThoughts} thoughts analyzed — {clusters.length} theme{clusters.length > 1 ? "s" : ""} emerging
          </p>

          <div className="space-y-3">
            {clusters.map((cluster) => (
              <div key={cluster.name} className="group">
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="material-symbols-outlined text-[18px] text-primary/70">{cluster.icon}</span>
                  <span className="text-xs font-semibold text-on-surface flex-1">{cluster.name}</span>
                  <span className="text-[10px] text-on-surface-variant/50 font-mono">{cluster.count}</span>
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
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/70">
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
          <h4 className="text-sm font-headline font-bold text-on-surface">Random Revisit</h4>
        </div>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          Record some thoughts first, and forgotten gems will resurface here.
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
          <h4 className="text-sm font-headline font-bold text-on-surface">Random Revisit</h4>
        </div>
        <button
          onClick={() => pickRandom(allThoughts)}
          className="text-on-surface-variant/50 hover:text-primary transition-colors"
          title="Shuffle"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
        </button>
      </div>

      {thought && (
        <button
          onClick={() => onSelect(thought)}
          className="w-full text-left group"
        >
          <p className="text-xs text-on-surface leading-relaxed line-clamp-3 group-hover:text-primary transition-colors">
            {thought.content}
          </p>
          <div className="flex items-center gap-2 mt-3">
            {thought.domain && (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {thought.domain}
              </span>
            )}
            <span className="text-[9px] text-on-surface-variant/40 font-mono">{timeAgo}</span>
          </div>
        </button>
      )}

      {thought && (
        <button
          onClick={() => navigate(`/thought/${thought.id}/chat`)}
          className="mt-4 w-full py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-[10px] font-bold uppercase tracking-widest active:scale-95 transition-all ghost-border"
        >
          Revisit & Reflect
        </button>
      )}
    </div>
  );
}
