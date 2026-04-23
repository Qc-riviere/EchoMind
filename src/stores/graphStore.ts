import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { GraphData, GraphEdge, GraphNode } from "../lib/types";

interface GraphStore {
  data: GraphData;
  loading: boolean;
  error: string | null;
  threshold: number; // max sqlite-vec distance to keep
  maxEdgesPerNode: number;
  loadGraph: () => Promise<void>;
  setThreshold: (t: number) => void;
  addNodeIncremental: (thoughtId: string) => Promise<void>;
  removeNode: (thoughtId: string) => void;
}

const EMPTY: GraphData = { nodes: [], edges: [] };

export const useGraphStore = create<GraphStore>((set, get) => ({
  data: EMPTY,
  loading: false,
  error: null,
  threshold: 0.6,
  maxEdgesPerNode: 5,

  loadGraph: async () => {
    set({ loading: true, error: null });
    try {
      const data = await invoke<GraphData>("get_embedding_graph", {
        maxDistance: get().threshold,
        maxEdgesPerNode: get().maxEdgesPerNode,
      });
      set({ data, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setThreshold: (t: number) => {
    set({ threshold: t });
    get().loadGraph();
  },

  addNodeIncremental: async (thoughtId: string) => {
    try {
      const node = await invoke<GraphNode>("get_graph_node", { thoughtId });
      const edges = await invoke<GraphEdge[]>("get_thought_neighbors", {
        thoughtId,
        k: get().maxEdgesPerNode,
        maxDistance: get().threshold,
      });
      const cur = get().data;
      // Replace node with same id (if any).
      const otherNodes = cur.nodes.filter((n) => n.id !== thoughtId);
      const nodes = [node, ...otherNodes];
      // Drop any old edges touching this node, then add the fresh set.
      const keptOld = cur.edges.filter((e) => e.source !== thoughtId && e.target !== thoughtId);
      // Dedupe edges across the union (source|target key).
      const seen = new Set<string>();
      const merged: GraphEdge[] = [];
      for (const e of [...keptOld, ...edges]) {
        const key = `${e.source}|${e.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(e);
        }
      }
      set({ data: { nodes, edges: merged } });
    } catch {
      // Ignore — will be picked up on next full reload.
    }
  },

  removeNode: (thoughtId: string) => {
    const cur = get().data;
    set({
      data: {
        nodes: cur.nodes.filter((n) => n.id !== thoughtId),
        edges: cur.edges.filter((e) => e.source !== thoughtId && e.target !== thoughtId),
      },
    });
  },
}));
