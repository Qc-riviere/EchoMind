import { useEffect } from "react";
import { useThoughtStore } from "../stores/thoughtStore";
import ThoughtCard from "./ThoughtCard";
import type { Thought } from "../lib/types";

interface Props {
  onThoughtClick?: (thought: Thought) => void;
  activeThoughtId?: string;
}

export default function ThoughtList({ onThoughtClick, activeThoughtId }: Props) {
  const { thoughts, loading, error, fetchThoughts, startPolling, stopPolling } = useThoughtStore();

  useEffect(() => {
    fetchThoughts();
    startPolling();
    return () => stopPolling();
  }, [fetchThoughts, startPolling, stopPolling]);

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
          showRelated={i === 0}
          onClick={() => onThoughtClick?.(thought)}
          isActive={thought.id === activeThoughtId}
        />
      ))}
    </div>
  );
}
