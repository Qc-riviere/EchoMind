import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";
import { useThoughtStore } from "../stores/thoughtStore";
import RelatedThoughts from "./RelatedThoughts";
import ThoughtImage from "./ThoughtImage";

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
  const hasImage = thought.image_path && isImageFile(thought.image_path);

  const timeAgo = formatDistanceToNow(new Date(thought.created_at), { addSuffix: true, locale: zhCN });
  const dateStr = new Date(thought.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();

  const handleOpenFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (thought.image_path) {
      try { await invoke("open_file", { filename: thought.image_path }); } catch {}
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-2xl overflow-hidden transition-all duration-500 cursor-pointer ${
        isActive
          ? "bg-surface-container-high translate-y-[-4px] ring-1 ring-primary/30"
          : "bg-surface-container-lowest hover:translate-y-[-4px]"
      }`}
    >
      <div className={`flex flex-col ${hasImage ? "md:flex-row items-stretch" : ""} h-full`}>
        {/* Image section (1/3 width) */}
        {hasImage && (
          <div className="w-full md:w-1/3 overflow-hidden bg-surface-container relative min-h-[180px]">
            <ThoughtImage
              filename={thought.image_path!}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700"
            />
          </div>
        )}

        {/* Non-image file attachment */}
        {thought.image_path && !isImageFile(thought.image_path) && (
          <div
            className="flex items-center gap-3 px-8 pt-6 cursor-pointer group/file"
            onClick={handleOpenFile}
          >
            <span className="material-symbols-outlined text-primary/60">description</span>
            <span className="text-sm text-on-surface-variant truncate">{thought.image_path}</span>
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40 group-hover/file:text-primary">open_in_new</span>
          </div>
        )}

        {/* Content section */}
        <div className={`flex-1 p-8 ${hasImage ? "bg-surface-container-low" : ""}`}>
          {/* Date & actions */}
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] text-on-surface-variant tracking-[0.2em] font-mono">{dateStr}</span>
            <button
              onClick={(e) => { e.stopPropagation(); }}
              className="text-on-surface-variant opacity-20 group-hover:opacity-100 hover:text-primary transition-all"
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
          </div>

        {/* Content text */}
        <h4 className="text-lg font-headline font-semibold text-on-surface mb-3 leading-tight break-words whitespace-pre-wrap">
          {thought.file_summary || thought.content}
        </h4>

          {/* Enriching indicator */}
          {isEnriching && (
            <div className="flex items-center gap-2 text-[10px] text-primary mb-4 tracking-wider uppercase">
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              AI Processing...
            </div>
          )}

          {/* Enrich error */}
          {enrichError && (
            <div className="flex items-center gap-2 text-[11px] text-error bg-error-container/20 rounded-lg px-3 py-2 mb-4">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span className="truncate flex-1">{enrichError}</span>
              <button
                onClick={(e) => { e.stopPropagation(); enrichAndEmbed(thought.id); }}
                className="text-error hover:text-on-error-container transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
              </button>
            </div>
          )}

          {/* AI Context insight */}
          {thought.context && (
            <p className="text-sm text-on-surface-variant/80 font-light leading-relaxed mb-6">
              {thought.context}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {thought.domain && (
              <span className="px-3 py-1 bg-surface-container-highest rounded-full text-[10px] text-secondary-fixed-dim tracking-wider uppercase font-semibold">
                {thought.domain}
              </span>
            )}
            {thought.tags?.split(",").map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-surface-container-highest rounded-full text-[10px] text-primary tracking-wider uppercase font-semibold"
              >
                {tag.trim()}
              </span>
            ))}
          </div>

          {/* Action buttons (visible on hover) */}
          <div className="flex items-center gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/thought/${thought.id}/chat`); }}
              className="flex items-center gap-1.5 text-[10px] text-on-surface-variant hover:text-primary uppercase tracking-wider transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
              对话
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); archiveThought(thought.id); }}
              className="flex items-center gap-1.5 text-[10px] text-on-surface-variant hover:text-error uppercase tracking-wider transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              归档
            </button>
          </div>

          {showRelated && <div className="mt-4"><RelatedThoughts thoughtId={thought.id} /></div>}
        </div>
      </div>
    </div>
  );
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.includes(ext);
}
