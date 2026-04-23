import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";
import { useGraphStore } from "./graphStore";

interface ThoughtStore {
  thoughts: Thought[];
  loading: boolean;
  error: string | null;
  enrichingIds: Set<string>;
  enrichErrors: Record<string, string>;
  _pollTimer: ReturnType<typeof setInterval> | null;
  fetchThoughts: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  addThought: (content: string) => Promise<Thought>;
  addThoughtWithImage: (content: string, imageData: string, ext: string, originalName?: string) => Promise<Thought>;
  updateThought: (id: string, content: string) => Promise<void>;
  archiveThought: (id: string) => Promise<void>;
  enrichAndEmbed: (thoughtId: string) => Promise<void>;
}

export const useThoughtStore = create<ThoughtStore>((set, get) => ({
  thoughts: [],
  loading: false,
  error: null,
  enrichingIds: new Set(),
  enrichErrors: {},
  _pollTimer: null,

  startPolling: () => {
    const state = get();
    if (state._pollTimer) return; // already polling
    const timer = setInterval(async () => {
      try {
        const thoughts = await invoke<Thought[]>("list_thoughts");
        const current = get().thoughts;
        // Detect change across the whole list (id, updated_at, image_path, file_summary)
        let changed = thoughts.length !== current.length;
        if (!changed) {
          for (let i = 0; i < thoughts.length; i++) {
            const a = thoughts[i];
            const b = current[i];
            if (
              a.id !== b.id ||
              a.updated_at !== b.updated_at ||
              a.image_path !== b.image_path ||
              a.file_summary !== b.file_summary
            ) {
              changed = true;
              break;
            }
          }
        }
        if (changed) set({ thoughts });
      } catch {
        // Silently ignore poll errors
      }
    }, 5000);
    set({ _pollTimer: timer });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) {
      clearInterval(timer);
      set({ _pollTimer: null });
    }
  },

  fetchThoughts: async () => {
    set({ loading: true, error: null });
    try {
      const thoughts = await invoke<Thought[]>("list_thoughts");
      set({ thoughts, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addThought: async (content: string) => {
    const thought = await invoke<Thought>("create_thought", { content });
    set({ thoughts: [thought, ...get().thoughts] });
    get().enrichAndEmbed(thought.id);
    return thought;
  },

  addThoughtWithImage: async (content: string, imageData: string, ext: string, originalName?: string) => {
    const filename = await invoke<string>("save_image", { data: imageData, ext, originalName });
    const thought = await invoke<Thought>("create_thought_with_image", {
      content,
      imagePath: filename,
    });
    set({ thoughts: [thought, ...get().thoughts] });
    get().enrichAndEmbed(thought.id);
    return thought;
  },

  enrichAndEmbed: async (thoughtId: string) => {
    const ids = new Set(get().enrichingIds);
    ids.add(thoughtId);
    const errors = { ...get().enrichErrors };
    delete errors[thoughtId];
    set({ enrichingIds: ids, enrichErrors: errors });

    try {
      const enriched = await invoke<Thought>("enrich_thought", { thoughtId });
      const updatedIds = new Set(get().enrichingIds);
      updatedIds.delete(thoughtId);
      set({
        thoughts: get().thoughts.map((t) =>
          t.id === enriched.id ? enriched : t
        ),
        enrichingIds: updatedIds,
      });
      await invoke("embed_thought", { thoughtId: enriched.id });
      // Push the new node into the graph store (no-op if graph page never opened).
      useGraphStore.getState().addNodeIncremental(enriched.id);
    } catch (e) {
      const updatedIds = new Set(get().enrichingIds);
      updatedIds.delete(thoughtId);
      set({
        enrichingIds: updatedIds,
        enrichErrors: { ...get().enrichErrors, [thoughtId]: String(e) },
      });
      await invoke("embed_thought", { thoughtId });
      useGraphStore.getState().addNodeIncremental(thoughtId);
    }
  },

  updateThought: async (id: string, content: string) => {
    const updated = await invoke<Thought>("update_thought", { id, content });
    set({
      thoughts: get().thoughts.map((t) => (t.id === id ? updated : t)),
    });
  },

  archiveThought: async (id: string) => {
    await invoke("archive_thought", { id });
    set({ thoughts: get().thoughts.filter((t) => t.id !== id) });
  },
}));
