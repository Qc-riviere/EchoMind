import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { invoke } from "@tauri-apps/api/core";
import type { GraphNode, Thought } from "../lib/types";
import { useGraphStore } from "../stores/graphStore";
import { useThoughtStore } from "../stores/thoughtStore";
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
const DEFAULT_COLOR = "#9ca3af";
const RECENT_COLOR = "#4ade80";

function colorForNode(n: FGNode): string {
  if (n.isRecent) return RECENT_COLOR;
  const d = n.domain?.trim().toLowerCase();
  return (d && DOMAIN_COLORS[d]) || DEFAULT_COLOR;
}

export default function GraphPage() {
  const { data, loading, error, threshold, loadGraph, setThreshold } = useGraphStore();
  const thoughts = useThoughtStore((s) => s.thoughts);
  const fetchThoughts = useThoughtStore((s) => s.fetchThoughts);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [selected, setSelected] = useState<Thought | null>(null);
  const [hovered, setHovered] = useState<FGNode | null>(null);

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
          <h1 className="text-2xl font-headline font-bold text-on-surface">Mind Graph</h1>
          <p className="text-xs text-on-surface-variant/60 mt-1">
            {graphData.nodes.length} thoughts · {graphData.links.length} connections
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
            <span>Similarity</span>
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
            Refresh
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
            <p className="text-sm">No embedded thoughts yet</p>
            <p className="text-[11px] text-on-surface-variant/50">
              Record thoughts and let AI process them — they'll appear here
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
              ctx.fillStyle = "rgba(255,255,255,0.85)";
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
            <div className="mt-1.5 flex gap-2 text-[10px] text-on-surface-variant/60">
              {hovered.domain && <span className="font-semibold uppercase">{hovered.domain}</span>}
              <span className="font-mono">{new Date(hovered.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </div>

      <ThoughtDrawer thought={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
