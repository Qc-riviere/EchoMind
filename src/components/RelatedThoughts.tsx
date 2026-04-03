import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link2 } from "lucide-react";
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
    <div className="mt-3 pl-4 border-l-2 border-[#c1c5fd]/50 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-[#575b8c] font-medium">
        <Link2 className="w-3 h-3" />
        <span>Related thoughts</span>
      </div>
      {related.slice(0, 3).map((t) => (
        <p key={t.id} className="text-xs text-[#5e5e68] leading-relaxed truncate">
          {t.content}
        </p>
      ))}
    </div>
  );
}
