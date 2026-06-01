import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";
import { useThoughtStore } from "../stores/thoughtStore";
import { formatRelative, formatFull } from "../lib/relativeTime";
import RelatedThoughts from "./RelatedThoughts";
import ThoughtImage from "./ThoughtImage";

interface Props {
  thought: Thought;
  showRelated?: boolean;
  onClick?: () => void;
  isActive?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onChanged?: () => void;
  /** Auto-expand the appendix tree on mount. Used when navigating to a card
      from a search hit on a child. */
  defaultExpanded?: boolean;
}

interface AppendixNode extends Thought {
  depth: number;
}

function buildAppendixTree(
  descendants: Thought[],
  rootId: string,
): AppendixNode[] {
  const byParent = new Map<string, Thought[]>();
  for (const d of descendants) {
    if (!d.parent_id) continue;
    const list = byParent.get(d.parent_id) ?? [];
    list.push(d);
    byParent.set(d.parent_id, list);
  }
  const out: AppendixNode[] = [];
  const walk = (parentId: string, depth: number) => {
    const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    for (const k of kids) {
      out.push({ ...k, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(rootId, 1);
  return out;
}

// Folder-fold layout constants (synced with the Claude Design prototype's
// "Appendix Folder" bundle — see outputs/design-bundle/echomind/project/).
const PEEK_OFFSET = 5; // px each layer drops behind the front card
const PEEK_LAYERS = 3; // max number of peek strips rendered
const INSET_STEP = 7; // px each layer narrows on both sides
const BACK_FADE = 0.62; // opacity^d for peek layers
const CLOSE_MS = 380; // matches the expanded list's transition duration

// Depth opacity for expanded mini-cards: depth 1 → 1.0, depth 2 → 0.84,
// depth 3 → 0.68, floored at 0.32.
const depthOpacity = (depth: number): number =>
  Math.max(0.32, 1 - (depth - 1) * 0.16);

export default function ThoughtCard({ thought, showRelated = false, onClick, isActive = false, selected = false, onToggleSelect, onChanged, defaultExpanded = false }: Props) {
  const archiveThought = useThoughtStore((s) => s.archiveThought);
  const enrichAndEmbed = useThoughtStore((s) => s.enrichAndEmbed);
  const enrichingIds = useThoughtStore((s) => s.enrichingIds);
  const enrichErrors = useThoughtStore((s) => s.enrichErrors);
  const navigate = useNavigate();

  const [descendants, setDescendants] = useState<Thought[]>([]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [closing, setClosing] = useState(false);
  const [appendTarget, setAppendTarget] = useState<string | null>(null);
  const [appendText, setAppendText] = useState("");
  const [appending, setAppending] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openFolder = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setExpanded(true);
  }, []);

  const closeFolder = useCallback(() => {
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setExpanded(false);
      setClosing(false);
      closeTimer.current = null;
    }, CLOSE_MS);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const loadDescendants = useCallback(() => {
    invoke<Thought[]>("list_thought_descendants", { rootId: thought.id })
      .then(setDescendants)
      .catch(() => setDescendants([]));
  }, [thought.id]);

  useEffect(() => {
    loadDescendants();
  }, [loadDescendants]);

  const tree = useMemo(
    () => buildAppendixTree(descendants, thought.id),
    [descendants, thought.id],
  );

  const handleAppend = async () => {
    const text = appendText.trim();
    if (!text || !appendTarget || appending) return;
    setAppending(true);
    try {
      await invoke("append_to_thought", { parentId: appendTarget, content: text });
      setAppendText("");
      setAppendTarget(null);
      openFolder();
      loadDescendants();
      onChanged?.();
    } catch {
      // surface via inline state later if needed
    } finally {
      setAppending(false);
    }
  };

  const handleDeleteChild = async (childId: string) => {
    try {
      await invoke("delete_thought", { id: childId });
      loadDescendants();
      onChanged?.();
    } catch {
      /* ignore */
    }
  };

  const isEnriching = enrichingIds.has(thought.id);
  const enrichError = enrichErrors[thought.id];
  const hasImage = thought.image_path && isImageFile(thought.image_path);

  const dateStr = new Date(thought.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();

  const handleOpenFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (thought.image_path) {
      try { await invoke("open_file", { filename: thought.image_path }); } catch {}
    }
  };

  const handleClick = () => onClick?.();

  // Visible peek layers behind the front card when collapsed. Cap to the
  // available descendants so we never render empty strips.
  const count = descendants.length;
  const layers = Math.min(PEEK_LAYERS, count);

  return (
    <div className="relative">
      {/* Folder-fold stack — peek sheets tucked BEHIND the front card. Each
          layer is narrower, lower, and fainter. Clicking any peek opens the
          folder. */}
      {!expanded && layers > 0 && Array.from({ length: layers }).map((_, i) => {
        const d = i + 1;
        return (
          <button
            key={`peek-${i}`}
            type="button"
            onClick={(e) => { e.stopPropagation(); openFolder(); }}
            aria-label={`展开 ${count} 条追加`}
            style={{
              position: "absolute",
              inset: 0,
              left: INSET_STEP * d,
              right: INSET_STEP * d,
              transform: `translateY(${PEEK_OFFSET * d}px)`,
              opacity: Math.max(0.18, Math.pow(BACK_FADE, d)),
              zIndex: layers - i,
              transition: "transform 420ms cubic-bezier(.22,1,.36,1), opacity 300ms ease",
            }}
            className="rounded-2xl bg-surface-container-low ghost-border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.7)]"
          />
        );
      })}

    <div
      onClick={handleClick}
      style={{ position: "relative", zIndex: layers + 1 }}
      className={`group rounded-2xl overflow-hidden transition-all duration-500 cursor-pointer ${
        selected
          ? "bg-surface-container-high translate-y-[-4px] ring-2 ring-primary"
          : isActive
          ? "bg-surface-container-high translate-y-[-4px] ring-1 ring-primary/30"
          : "bg-surface-container-lowest hover:translate-y-[-4px]"
      }`}
    >
      {thought.is_pinned && !selected && (
        <div className="absolute top-4 right-4 z-10 pointer-events-none">
          <span className="material-symbols-outlined text-[18px] text-primary rotate-45" aria-hidden="true">push_pin</span>
        </div>
      )}
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
          {/* Date & select toggle (the three-dots morph into a checkbox on hover
              — clicking it adds this card to the multi-select queue) */}
          <div className="flex justify-between items-start mb-4">
            <span className="text-[11px] text-on-surface-variant tracking-[0.2em] font-mono">{dateStr}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
              aria-label={selected ? "取消选择" : "选择此条"}
              aria-pressed={selected}
              className={`group/sel relative w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                selected
                  ? "bg-primary text-on-primary opacity-100"
                  : "text-on-surface-variant opacity-20 group-hover:opacity-100 hover:bg-surface-container-high hover:text-primary"
              }`}
            >
              {selected ? (
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined text-[20px] group-hover/sel:opacity-0 transition-opacity"
                    aria-hidden="true"
                  >
                    more_horiz
                  </span>
                  <span
                    className="material-symbols-outlined text-[18px] absolute opacity-0 group-hover/sel:opacity-100 transition-opacity"
                    aria-hidden="true"
                  >
                    check_box_outline_blank
                  </span>
                </>
              )}
            </button>
          </div>

        {/* Content text */}
        <h4 className="text-lg font-headline font-semibold text-on-surface mb-3 leading-tight break-words whitespace-pre-wrap">
          {thought.file_summary || thought.content}
        </h4>

          {/* Enriching indicator */}
          {isEnriching && (
            <div className="flex items-center gap-2 text-[11px] text-primary mb-4 tracking-wider uppercase">
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
              <span className="px-3 py-1 bg-surface-container-highest rounded-full text-[11px] text-secondary-fixed-dim tracking-wider uppercase font-semibold">
                {thought.domain}
              </span>
            )}
            {thought.tags?.split(",").map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-surface-container-highest rounded-full text-[11px] text-primary tracking-wider uppercase font-semibold"
              >
                {tag.trim()}
              </span>
            ))}
          </div>

          {/* Action buttons (visible on hover) */}
          <div className="flex items-center gap-3 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/thought/${thought.id}/chat`); }}
              className="flex items-center gap-1.5 text-[11px] text-on-surface-variant hover:text-primary uppercase tracking-wider transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
              对话
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAppendTarget(thought.id);
                setAppendText("");
              }}
              className="flex items-center gap-1.5 text-[11px] text-on-surface-variant hover:text-primary uppercase tracking-wider transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              追加
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await invoke("set_pinned_thought", { id: thought.id, pinned: !thought.is_pinned });
                  onChanged?.();
                } catch { /* ignore */ }
              }}
              className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider transition-colors ${
                thought.is_pinned
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">push_pin</span>
              {thought.is_pinned ? "已置顶" : "置顶"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); archiveThought(thought.id); onChanged?.(); }}
              className="flex items-center gap-1.5 text-[11px] text-on-surface-variant hover:text-error uppercase tracking-wider transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              归档
            </button>
          </div>

          {/* Inline append form */}
          {appendTarget && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-3 p-3 rounded-xl bg-surface-container ghost-border"
            >
              <textarea
                value={appendText}
                onChange={(e) => setAppendText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAppend();
                  }
                }}
                placeholder={appendTarget === thought.id ? "追加到此灵感…（Cmd/Ctrl+Enter 发送）" : "追加到此追加…"}
                className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm resize-none text-on-surface placeholder:text-on-surface-variant/40"
                rows={2}
                autoFocus
                disabled={appending}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => { setAppendTarget(null); setAppendText(""); }}
                  className="text-[11px] text-on-surface-variant/60 hover:text-on-surface px-2 py-1"
                  disabled={appending}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAppend}
                  disabled={!appendText.trim() || appending}
                  className="text-[11px] bg-primary text-on-primary px-3 py-1 rounded-md disabled:opacity-40 hover:brightness-110"
                >
                  {appending ? "追加中…" : "追加"}
                </button>
              </div>
            </div>
          )}

          {showRelated && <div className="mt-4"><RelatedThoughts thoughtId={thought.id} /></div>}
        </div>
      </div>
    </div>

      {/* Folder handle — the only clickable surface that lives BELOW the peek
          stack (never clipped by the front card's rounded overflow-hidden).
          The marginTop clears the lowest peek layer. */}
      {!expanded && count > 0 && (
        <div
          className="flex justify-center"
          style={{ marginTop: PEEK_OFFSET * layers + 2 }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openFolder(); }}
            className="group/tab flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-primary text-[11px] font-semibold tracking-wide transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">folder_copy</span>
            {count} 条追加
            <span className="material-symbols-outlined text-[15px] transition-transform group-hover/tab:translate-y-0.5">expand_more</span>
          </button>
        </div>
      )}

      {/* Expanded appendix list — owns its own entrance/exit animation. */}
      {expanded && tree.length > 0 && (
        <AppendixList
          tree={tree}
          closing={closing}
          onAppend={(id) => { setAppendTarget(id); setAppendText(""); }}
          onDelete={handleDeleteChild}
          onCollapse={closeFolder}
        />
      )}
    </div>
  );
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.includes(ext);
}

function AppendixCard({
  node,
  shown,
  index,
  total,
  onAppend,
  onDelete,
}: {
  node: AppendixNode;
  shown: boolean;
  index: number;
  total: number;
  onAppend: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // Stagger entrance forward, exit reverse — so closing the folder collapses
  // bottom-to-top like sheets gathering back.
  const delay = (shown ? index : total - 1 - index) * 55;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginLeft: (node.depth - 1) * 18,
        opacity: shown ? depthOpacity(node.depth) : 0,
        transform: shown
          ? "translateY(0) scale(1)"
          : "translateY(-14px) scale(0.97)",
        transition: `opacity 360ms cubic-bezier(.22,1,.36,1) ${delay}ms, transform 420ms cubic-bezier(.22,1,.36,1) ${delay}ms`,
      }}
      className="group/ap relative rounded-2xl bg-surface-container-low ghost-border p-4 hover:!opacity-100"
    >
      {node.depth > 1 && (
        <span
          className="material-symbols-outlined absolute -left-[14px] top-5 text-[16px] text-outline-variant"
          aria-hidden="true"
        >
          subdirectory_arrow_right
        </span>
      )}
      <div className="flex items-start justify-between mb-1.5">
        <span
          className="text-[10px] text-on-surface-variant/50 tracking-[0.2em] font-mono"
          title={formatFull(node.created_at)}
        >
          {formatRelative(node.created_at)}
        </span>
        <div className="opacity-0 group-hover/ap:opacity-100 transition-opacity flex gap-0.5">
          <button
            type="button"
            onClick={() => onAppend(node.id)}
            className="p-1 text-on-surface-variant/60 hover:text-primary"
            title="继续追加到此条"
            aria-label="继续追加"
          >
            <span className="material-symbols-outlined text-[15px]">add</span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="p-1 text-on-surface-variant/60 hover:text-error"
            title="删除此追加"
            aria-label="删除追加"
          >
            <span className="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </div>
      </div>
      <p className="text-sm text-on-surface whitespace-pre-wrap break-words leading-relaxed">
        {node.content}
      </p>
    </div>
  );
}

function AppendixList({
  tree,
  closing,
  onAppend,
  onDelete,
  onCollapse,
}: {
  tree: AppendixNode[];
  closing: boolean;
  onAppend: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  // useEffect fires reliably after commit (rAF is throttled when the tab
  // isn't compositing), so the entrance animation always plays even on
  // initial mount.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(id);
  }, []);
  const shown = entered && !closing;

  return (
    <div className="mt-2 space-y-2">
      {tree.map((node, i) => (
        <AppendixCard
          key={node.id}
          node={node}
          index={i}
          total={tree.length}
          shown={shown}
          onAppend={onAppend}
          onDelete={onDelete}
        />
      ))}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCollapse(); }}
        className="flex items-center gap-1 text-[11px] text-on-surface-variant/50 hover:text-primary transition-colors pt-1"
      >
        <span className="material-symbols-outlined text-[15px]">unfold_less</span>
        收起
      </button>
    </div>
  );
}
