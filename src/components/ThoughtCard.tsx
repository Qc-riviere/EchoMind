import { Archive, MessageSquare, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import type { Thought } from "../lib/types";
import { useThoughtStore } from "../stores/thoughtStore";
import RelatedThoughts from "./RelatedThoughts";

interface Props {
  thought: Thought;
  showRelated?: boolean;
  onClick?: () => void;
  isActive?: boolean;
}

export default function ThoughtCard({ thought, showRelated = false, onClick, isActive = false }: Props) {
  const archiveThought = useThoughtStore((s) => s.archiveThought);
  const enrichAndEmbed = useThoughtStore((s) => s.enrichAndEmbed);
  const enrichingIds = useThoughtStore((s) => s.enrichingIds);
  const enrichErrors = useThoughtStore((s) => s.enrichErrors);
  const navigate = useNavigate();

  const isEnriching = enrichingIds.has(thought.id);
  const enrichError = enrichErrors[thought.id];

  const timeAgo = formatDistanceToNow(new Date(thought.created_at), {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <div 
      onClick={onClick}
      className={`group cursor-pointer rounded-2xl p-5 transition-all duration-400 ease-[cubic-bezier(0.25,0.8,0.25,1)] border ${
        isActive 
          ? 'bg-white shadow-[0_16px_40px_-8px_rgba(87,91,140,0.25)] border-[#c1c5fd] -translate-y-1.5 z-10 relative ring-4 ring-[#c1c5fd]/20' 
          : 'bg-white/70 backdrop-blur-sm shadow-[0_4px_16px_rgba(87,91,140,0.04)] border-white/60 hover:bg-white hover:shadow-[0_12px_40px_-8px_rgba(87,91,140,0.2)] hover:-translate-y-1.5'
      }`}
    >
      <p className="text-[#31323b] leading-relaxed mb-4 text-lg">
        {thought.content}
      </p>

      {isEnriching && (
        <div className="flex items-center gap-2 text-xs text-[#575b8c] mb-4 bg-[#c1c5fd]/10 w-fit px-3 py-1.5 rounded-full">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="font-medium">AI 正在思考...</span>
        </div>
      )}

      {enrichError && (
        <div className="flex items-center gap-2 text-xs text-[#a8364b] bg-[#f97386]/10 rounded-xl px-3 py-2 mb-4 border border-[#f97386]/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="truncate flex-1">{enrichError}</span>
          <button
            onClick={(e) => { e.stopPropagation(); enrichAndEmbed(thought.id); }}
            className="shrink-0 text-[#a8364b] hover:text-[#7d2435] bg-white/50 p-1 rounded-md transition-colors"
            title="重试"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {thought.context && (
        <div className="mb-5 mt-2">
          <div className="bg-gradient-to-r from-[#f4f0fa] to-white/50 rounded-2xl p-4 border border-[#e3e1ed]/60 shadow-sm relative overflow-hidden group/insight">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#575b8c] to-[#c1c5fd] rounded-l-2xl"></div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-[#575b8c] uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#575b8c]/50"></span>
                AI Insight
              </span>
            </div>
            <p className="text-sm text-[#5e5e68] leading-relaxed relative z-10">
              {thought.context}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 pt-4 border-t border-[#e3e1ed]/50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[#a1a1aa] font-medium">{timeAgo}</span>
          {thought.domain && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-[#f6d0fd]/50 text-[#855392] font-medium border border-[#f6d0fd]">
              {thought.domain}
            </span>
          )}
          {thought.tags &&
            thought.tags.split(",").map((tag) => (
              <span
                key={tag}
                className="text-xs px-2.5 py-1 rounded-full bg-[#f4f0fa] text-[#6b6e8a] border border-[#e3e1ed]"
              >
                {tag.trim()}
              </span>
            ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/thought/${thought.id}/chat`); }}
            className="text-[#a1a1aa] hover:text-[#575b8c] hover:bg-[#c1c5fd]/20 transition-all p-2 rounded-xl group-hover:bg-[#f4f0fa]"
            title="进入深度拷问"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); archiveThought(thought.id); }}
            className="text-[#a1a1aa] hover:text-[#a8364b] hover:bg-[#f97386]/10 transition-all p-2 rounded-xl group-hover:bg-[#f4f0fa]"
            title="归档"
          >
            <Archive className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showRelated && <div className="mt-4"><RelatedThoughts thoughtId={thought.id} /></div>}
    </div>
  );
}
