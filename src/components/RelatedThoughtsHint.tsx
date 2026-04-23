import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
    <div className="relative mt-3 p-4 bg-surface-container-low rounded-2xl ghost-border">
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>

      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
        <span className="text-sm font-headline font-semibold text-primary">你之前有过类似的想法</span>
      </div>

      <div className="space-y-2 pl-6">
        {related.map((t) => (
          <p key={t.id} className="text-sm text-on-surface-variant leading-relaxed">
            <span className="text-on-surface-variant/30 mr-2">•</span>
            {t.content.length > 80 ? t.content.slice(0, 80) + "..." : t.content}
          </p>
        ))}
      </div>

      <div className="mt-3 pl-6">
        <a
          href={`/chat/${thoughtId}`}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">link</span>
          <span>进入拷问</span>
        </a>
      </div>
    </div>
  );
}
