import { useEffect } from "react";
import { useThoughtStore } from "../stores/thoughtStore";
import ThoughtCard from "./ThoughtCard";
import type { Thought } from "../lib/types";

interface Props {
  onThoughtClick?: (thought: Thought) => void;
  activeThoughtId?: string;
  /// If provided, render these directly instead of subscribing to the store.
  thoughts?: Thought[];
  /// Hide the empty-state card (caller will render its own placeholder).
  hideEmpty?: boolean;
  /// Selection mode flag — when true, cards show a checkbox and clicking
  /// toggles selection instead of opening the drawer.
  selectMode?: boolean;
  /// Set of currently selected thought ids (used when `selectMode` is true).
  selectedIds?: Set<string>;
  /// Called with a thought id when the user toggles selection on a card.
  onToggleSelect?: (id: string) => void;
}

export default function ThoughtList({
  onThoughtClick,
  activeThoughtId,
  thoughts: thoughtsProp,
  hideEmpty,
  selectMode,
  selectedIds,
  onToggleSelect,
}: Props) {
  const store = useThoughtStore();
  const useStore = thoughtsProp === undefined;

  useEffect(() => {
    if (!useStore) return;
    store.fetchThoughts();
    store.startPolling();
    return () => store.stopPolling();
  }, [useStore, store.fetchThoughts, store.startPolling, store.stopPolling]);

  const thoughts = thoughtsProp ?? store.thoughts;
  const loading = useStore && store.loading;
  const error = useStore ? store.error : null;

  if (loading && thoughts.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-on-surface-variant gap-3">
        <span className="material-symbols-outlined animate-spin">progress_activity</span>
        正在唤醒灵感...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-error bg-error-container/20 rounded-2xl">
        加载失败: {error}
      </div>
    );
  }

  if (thoughts.length === 0) {
    if (hideEmpty) return null;
    return (
      <div className="text-center py-20 space-y-4 bg-surface-container-low rounded-2xl">
        <span className="material-symbols-outlined text-6xl text-primary/40">lightbulb</span>
        <div>
          <p className="text-lg font-headline font-semibold text-on-surface">还没有灵感</p>
          <p className="text-on-surface-variant text-sm mt-1">记录你的第一个想法吧，哪怕只是个词</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {thoughts.map((thought, i) => (
        <ThoughtCard
          key={thought.id}
          thought={thought}
          showRelated={useStore && i === 0 && !selectMode}
          onClick={() => onThoughtClick?.(thought)}
          isActive={thought.id === activeThoughtId}
          selectMode={selectMode}
          selected={selectedIds?.has(thought.id) ?? false}
          onToggleSelect={() => onToggleSelect?.(thought.id)}
        />
      ))}
    </div>
  );
}
