import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link2, X, Sparkles } from "lucide-react";
import type { Thought } from "../lib/types";

interface Props {
  thoughtId: string;
  onDismiss: () => void;
}

export default function RelatedThoughtsHint({ thoughtId, onDismiss }: Props) {
  const [related, setRelated] = useState<Thought[]>([]);

  useEffect(() => {
    invoke<Thought[]>("find_related_thoughts", { thoughtId, limit: 3 })
      .then(setRelated)
      .catch(() => setRelated([]));
  }, [thoughtId]);

  if (related.length === 0) return null;

  return (
    <div className="relative mt-3 p-4 bg-gradient-to-r from-[#f8f7ff] to-white rounded-2xl border border-[#c1c5fd]/30 shadow-[0_4px_20px_rgba(87,91,140,0.08)]">
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-[#a1a1aa] hover:text-[#575b8c] hover:bg-white/60 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-[#575b8c]" />
        <span className="text-sm font-semibold text-[#575b8c]">你之前有过类似的想法</span>
      </div>
      
      <div className="space-y-2 pl-6">
        {related.map((t) => (
          <p key={t.id} className="text-sm text-[#5e5e68] leading-relaxed">
            <span className="text-[#a1a1aa] mr-2">•</span>
            {t.content.length > 80 ? t.content.slice(0, 80) + "..." : t.content}
          </p>
        ))}
      </div>
      
      <div className="mt-3 pl-6">
        <a
          href={`/chat/${thoughtId}`}
          className="inline-flex items-center gap-1.5 text-sm text-[#575b8c] hover:text-[#434670] font-medium transition-colors"
        >
          <Link2 className="w-3.5 h-3.5" />
          <span>进入拷问</span>
        </a>
      </div>
    </div>
  );
}
