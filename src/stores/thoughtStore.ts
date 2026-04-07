import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";

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
        // Only update if data changed (compare by count + first item timestamp)
        if (
          thoughts.length !== current.length ||
          thoughts[0]?.updated_at !== current[0]?.updated_at ||
          thoughts[0]?.id !== current[0]?.id
        ) {
          set({ thoughts });
        }
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
    } catch (e) {
      const updatedIds = new Set(get().enrichingIds);
      updatedIds.delete(thoughtId);
      set({
        enrichingIds: updatedIds,
        enrichErrors: { ...get().enrichErrors, [thoughtId]: String(e) },
      });
      await invoke("embed_thought", { thoughtId });
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
