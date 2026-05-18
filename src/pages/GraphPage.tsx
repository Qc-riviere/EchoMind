import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { invoke } from "@tauri-apps/api/core";
import type { GraphNode, Thought } from "../lib/types";
import { useGraphStore } from "../stores/graphStore";
import { useThoughtStore } from "../stores/thoughtStore";
import { useThemeStore } from "../stores/themeStore";
import ThoughtDrawer from "../components/ThoughtDrawer";

// react-force-graph mutates node objects to add x/y/vx/vy/index props.
type FGNode = GraphNode & {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  isRecent?: boolean;
};

type FGLink = { source: string | FGNode; target: string | FGNode; weight: number };

const DOMAIN_COLORS: Record<string, string> = {
  technology: "#7dd3fc",
  science: "#a78bfa",
  design: "#f9a8d4",
  business: "#fcd34d",
  personal: "#fda4af",
  creative: "#fdba74",
  philosophy: "#c4b5fd",
  health: "#86efac",
  education: "#93c5fd",
  finance: "#fde68a",
};
const DOMAIN_LABELS_CN: Record<string, string> = {
  technology: "技术",
  science: "科学",
  design: "设计",
  business: "商业",
  personal: "个人",
  creative: "创作",
  philosophy: "哲学",
  health: "健康",
  education: "教育",
  finance: "金融",
};
const DEFAULT_COLOR = "#9ca3af";
const RECENT_COLOR = "#4ade80";

// Stable color from an arbitrary domain string — same input always maps to
// the same hue, so user-introduced domains (e.g. "工作", "AI") still color
// consistently across renders without needing a fixed lookup table.
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 60%, 70%)`;
}

function colorForNode(n: FGNode): string {
  if (n.isRecent) return RECENT_COLOR;
  const d = n.domain?.trim().toLowerCase();
  if (!d) return DEFAULT_COLOR;
  return DOMAIN_COLORS[d] ?? hashColor(d);
}

export default function GraphPage() {
  const { data, loading, error, threshold, loadGraph, setThreshold } = useGraphStore();
  const thoughts = useThoughtStore((s) => s.thoughts);
  const fetchThoughts = useThoughtStore((s) => s.fetchThoughts);
  const theme = useThemeStore((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [selected, setSelected] = useState<Thought | null>(null);
  const [hovered, setHovered] = useState<FGNode | null>(null);

  const isDark = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [theme]);
  const labelColor = isDark ? "rgba(230,230,235,0.85)" : "rgba(0,0,0,0.75)";

  // Initial load.
  useEffect(() => {
    loadGraph();
    if (thoughts.length === 0) fetchThoughts();
  }, [loadGraph, fetchThoughts, thoughts.length]);

  // Resize observer for canvas.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tag recent (last 24h) nodes.
  const graphData = useMemo(() => {
    const now = Date.now();
    const RECENT_MS = 24 * 60 * 60 * 1000;
    const nodes: FGNode[] = data.nodes.map((n) => ({
      ...n,
      isRecent: now - new Date(n.created_at).getTime() < RECENT_MS,
    }));
    const links: FGLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }));
    return { nodes, links };
  }, [data]);

  const handleNodeClick = useCallback(
    async (node: FGNode) => {
      try {
        const t = await invoke<Thought>("get_thought", { id: node.id });
        setSelected(t);
      } catch {
        // fall back to whatever is in the local store
        const t = thoughts.find((x) => x.id === node.id);
        if (t) setSelected(t);
      }
    },
    [thoughts]
  );

  const nodeSize = (n: FGNode) => 3 + Math.sqrt(n.content_length) * 0.4;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">思维图谱</h1>
          <p className="text-xs text-on-surface-variant/60 mt-1">
            {graphData.nodes.length} 条想法 · {graphData.links.length} 条关联
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
            <span>相似度阈值</span>
            <input
              type="range"
              min={0.2}
              max={1.0}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-32 accent-primary"
            />
            <span className="font-mono">{threshold.toFixed(2)}</span>
          </div>
          <button
            onClick={() => loadGraph()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-[11px] text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            刷新
          </button>
        </div>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 mx-8 mb-8 rounded-2xl bg-surface-container-lowest border border-outline-variant/10 overflow-hidden relative"
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-error">
            {error}
          </div>
        )}
        {!loading && !error && graphData.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant gap-3">
            <span className="material-symbols-outlined text-5xl text-primary/40">hub</span>
            <p className="text-sm">还没有向量化的想法</p>
            <p className="text-[11px] text-on-surface-variant/50">
              记录想法并让 AI 处理后，它们会出现在这里
            </p>
          </div>
        )}
        {!loading && !error && graphData.nodes.length > 0 && (
          <ForceGraph2D
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={4}
            nodeVal={(n) => nodeSize(n as FGNode)}
            nodeColor={(n) => colorForNode(n as FGNode)}
            nodeLabel={(n) => (n as FGNode).label}
            linkColor={() => "rgba(180,180,180,0.25)"}
            linkWidth={(l) => Math.max(0.4, ((l as FGLink).weight ?? 0.3) * 1.5)}
            cooldownTicks={120}
            onNodeClick={(n) => handleNodeClick(n as FGNode)}
            onNodeHover={(n) => setHovered((n as FGNode) ?? null)}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node, ctx, scale) => {
              const n = node as FGNode;
              if (scale < 1.2 && !n.isRecent) return;
              const label = n.label;
              const fontSize = Math.max(10, 12 / scale);
              ctx.font = `${fontSize}px sans-serif`;
              ctx.fillStyle = labelColor;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + nodeSize(n) + 2);
            }}
          />
        )}

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute bottom-4 left-4 max-w-sm p-3 rounded-lg bg-surface-container-high/95 backdrop-blur border border-outline-variant/20 pointer-events-none">
            <p className="text-xs text-on-surface line-clamp-3">{hovered.label}</p>
            <div className="mt-1.5 flex gap-2 text-[11px] text-on-surface-variant/60">
              {hovered.domain && (
                <span className="font-semibold">
                  {DOMAIN_LABELS_CN[hovered.domain.trim().toLowerCase()] ?? hovered.domain}
                </span>
              )}
              <span className="font-mono">{new Date(hovered.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        {/* Color legend */}
        {!loading && !error && graphData.nodes.length > 0 && (
          <div className="absolute top-4 right-4 max-w-[220px] p-3 rounded-lg bg-surface-container-high/90 backdrop-blur border border-outline-variant/20 text-[11px] text-on-surface-variant pointer-events-none">
            <div className="font-semibold text-on-surface mb-2">图例</div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: RECENT_COLOR }} />
              <span>近 24 小时新建</span>
            </div>
            <div className="text-on-surface-variant/70 mb-1">其他颜色按主题分类：</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {Object.entries(DOMAIN_COLORS).map(([key, color]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span>{DOMAIN_LABELS_CN[key] ?? key}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DEFAULT_COLOR }} />
                <span>未分类</span>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-outline-variant/15 text-on-surface-variant/60">
              其他主题：按名称自动配色
            </div>
          </div>
        )}
      </div>

      <ThoughtDrawer thought={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
