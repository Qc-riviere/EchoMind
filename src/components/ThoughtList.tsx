import { useEffect } from "react";
import { useThoughtStore } from "../stores/thoughtStore";
import ThoughtCard from "./ThoughtCard";
import { Lightbulb } from "lucide-react";
import type { Thought } from "../lib/types";

interface Props {
  onThoughtClick?: (thought: Thought) => void;
  activeThoughtId?: string;
}

export default function ThoughtList({ onThoughtClick, activeThoughtId }: Props) {
  const { thoughts, loading, error, fetchThoughts } = useThoughtStore();

  useEffect(() => {
    fetchThoughts();
  }, [fetchThoughts]);

  if (loading && thoughts.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[#7a7a84] gap-3">
        <div className="w-5 h-5 border-2 border-[#575b8c]/30 border-t-[#575b8c] rounded-full animate-spin" />
        正在唤醒灵感...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-[#a8364b] bg-[#f97386]/10 rounded-2xl border border-[#f97386]/20">
        加载失败: {error}
      </div>
    );
  }

  if (thoughts.length === 0) {
    return (
      <div className="text-center py-20 space-y-4 bg-white/40 backdrop-blur-sm rounded-3xl border border-white/60 shadow-sm">
        <Lightbulb className="w-16 h-16 mx-auto text-[#c1c5fd] drop-shadow-md" />
        <div>
          <p className="text-lg font-medium text-[#575b8c]">还没有灵感</p>
          <p className="text-[#a1a1aa] mt-1">记录你的第一个想法吧，哪怕只是个词</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {thoughts.map((thought, i) => (
        <div key={thought.id} className="transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]">
          <ThoughtCard 
            thought={thought} 
            showRelated={i === 0} 
            onClick={() => onThoughtClick?.(thought)}
            isActive={thought.id === activeThoughtId}
          />
        </div>
      ))}
    </div>
  );
}
