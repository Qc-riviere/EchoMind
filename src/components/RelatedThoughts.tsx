import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";

interface Props {
  thoughtId: string;
}

export default function RelatedThoughts({ thoughtId }: Props) {
  const [related, setRelated] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<Thought[]>("find_related_thoughts", { thoughtId })
      .then(setRelated)
      .catch(() => setRelated([]))
      .finally(() => setLoading(false));
  }, [thoughtId]);

  if (loading || related.length === 0) return null;

  return (
    <div className="mt-3 pl-4 border-l-2 border-primary/30 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
        <span className="material-symbols-outlined text-[14px]">link</span>
        <span>Related thoughts</span>
      </div>
      {related.slice(0, 3).map((t) => (
        <p key={t.id} className="text-xs text-on-surface-variant leading-relaxed truncate">
          {t.content}
        </p>
      ))}
    </div>
  );
}
