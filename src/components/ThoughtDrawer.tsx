import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Thought } from "../lib/types";
import { useThoughtStore } from "../stores/thoughtStore";
import { format } from "date-fns";
import ConfirmDialog from "./ConfirmDialog";
import { invoke } from "@tauri-apps/api/core";
import ThoughtImage from "./ThoughtImage";

interface Props {
  thought: Thought | null;
  onClose: () => void;
}

export default function ThoughtDrawer({ thought, onClose }: Props) {
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [displayThought, setDisplayThought] = useState<Thought | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const updateThought = useThoughtStore((s) => s.updateThought);
  const archiveThought = useThoughtStore((s) => s.archiveThought);
  const setThoughts = useThoughtStore.setState;
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isOpen = !!thought;

  const handleOpenFile = async () => {
    if (displayThought?.image_path) {
      try { await invoke("open_file", { filename: displayThought.image_path }); } catch {}
    }
  };

  useEffect(() => {
    if (thought) {
      setDisplayThought(thought);
      setContent(thought.content);
      setLastSavedContent(thought.content);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
      }, 50);
    }
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [thought]);

  const handleSave = async (contentToSave: string) => {
    if (!displayThought || contentToSave.trim() === lastSavedContent || !contentToSave.trim()) return;
    setIsSaving(true);
    try {
      await updateThought(displayThought.id, contentToSave.trim());
      setLastSavedContent(contentToSave.trim());
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } finally { setIsSaving(false); }
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => handleSave(newContent), 1500);
  };

  const hasUnsavedChanges = content.trim() !== lastSavedContent && content.trim() !== "";

  const handleClose = async () => {
    if (hasUnsavedChanges) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      await handleSave(content);
    }
    onClose();
  };

  const confirmArchive = async () => {
    if (!displayThought) return;
    if (hasUnsavedChanges) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      await handleSave(content);
    }
    archiveThought(displayThought.id);
    setShowArchiveConfirm(false);
    onClose();
  };

  const handleReanalyze = async () => {
    if (!displayThought || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      if (hasUnsavedChanges) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        await handleSave(content);
      }
      const enriched = await invoke<Thought>("enrich_thought", { thoughtId: displayThought.id });
      setDisplayThought(enriched);
      // Sync to global store so home/list reflects the new enrichment
      setThoughts((state) => ({
        thoughts: state.thoughts.map((t) => (t.id === enriched.id ? enriched : t)),
      }));
      // Re-embed in background so search/related uses the new content
      invoke("embed_thought", { thoughtId: enriched.id }).catch(() => {});
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (e) {
      console.error("Failed to re-analyze:", e);
    } finally { setIsAnalyzing(false); }
  };

  return (
    <>
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="确认归档"
        message="归档后这条灵感将从主列表移除，你可以在归档页面找到它并恢复。"
        confirmText="归档"
        cancelText="取消"
        variant="warning"
        icon="archive"
        onConfirm={confirmArchive}
        onCancel={() => setShowArchiveConfirm(false)}
      />

      {isOpen && <div className="fixed inset-0 z-40 bg-black/30" onClick={handleClose} />}

      <div
        className={`fixed top-4 right-4 bottom-4 z-50 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          isOpen ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[120%] pointer-events-none"
        }`}
        style={{ width: "420px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full h-full bg-surface-container-low flex flex-col overflow-hidden rounded-2xl border border-outline-variant/10">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pb-5 border-b border-outline-variant/10">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">lightbulb</span>
              <h2 className="font-headline font-semibold text-on-surface text-sm">Edit Inspiration</h2>
            </div>
            <div className="flex items-center gap-2">
              {isSaving && (
                <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span> Saving
                </span>
              )}
              {showSaved && !isSaving && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  <span className="material-symbols-outlined text-[14px]">check</span> Saved
                </span>
              )}
            </div>
            <button onClick={handleClose} className="p-2 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container-high transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Content */}
          {displayThought && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* File attachment */}
              {displayThought.image_path && isImageFile(displayThought.image_path) && (
                <div className="rounded-xl overflow-hidden bg-surface-container-lowest">
                  <ThoughtImage filename={displayThought.image_path} className="w-full max-h-80 object-contain" />
                </div>
              )}

              {displayThought.image_path && !isImageFile(displayThought.image_path) && (
                <div className="flex items-center gap-3 rounded-xl bg-surface-container-lowest px-4 py-3 cursor-pointer hover:bg-surface-container transition-colors" onClick={handleOpenFile}>
                  <span className="material-symbols-outlined text-primary/60">description</span>
                  <span className="text-sm text-on-surface-variant truncate flex-1">{displayThought.image_path}</span>
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40">open_in_new</span>
                </div>
              )}

              {/* Date */}
              <div className="text-xs text-on-surface-variant/60 font-mono">
                {format(new Date(displayThought.created_at), "MMM d, h:mm a").toUpperCase()}
              </div>

              {/* File summary (read-only) */}
              {displayThought.file_summary && (
                <p className="text-base text-on-surface leading-relaxed">{displayThought.file_summary}</p>
              )}

              {/* AI context (read-only) */}
              {displayThought.context && (
                <p className="text-sm text-on-surface-variant/70 leading-relaxed">{displayThought.context}</p>
              )}

              {/* Editable content */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  handleContentChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                placeholder="写下你的想法..."
                className="w-full bg-transparent border-none p-0 text-sm text-on-surface leading-relaxed resize-none focus:outline-none placeholder:text-on-surface-variant/30"
              />

              {/* Tags */}
              {(displayThought.domain || displayThought.tags) && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {displayThought.domain && (
                    <span className="px-3 py-1 bg-surface-container-highest rounded-full text-[10px] text-on-surface-variant tracking-wider font-semibold">
                      {displayThought.domain}
                    </span>
                  )}
                  {displayThought.tags?.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                    <span key={tag} className="px-3 py-1 bg-surface-container-highest rounded-full text-[10px] text-on-surface-variant tracking-wider font-semibold">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          {displayThought && (
            <div className="px-5 py-4 border-t border-outline-variant/10">
              {isAnalyzing && (
                <div className="flex items-center gap-2 mb-3 text-[10px] text-primary bg-primary/5 rounded-lg px-3 py-2">
                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                  AI Re-analyzing...
                </div>
              )}
              <div className="grid grid-cols-4 gap-1.5">
                  <button onClick={handleReanalyze} disabled={isAnalyzing}
                    className="flex items-center justify-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wider rounded-lg text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-50 transition-colors">
                    <span className="material-symbols-outlined text-[16px]">{isAnalyzing ? "progress_activity" : "auto_awesome"}</span>
                    Analyze
                  </button>
                  <button onClick={() => navigate(`/thought/${displayThought.id}/chat`)}
                    className="flex items-center justify-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wider rounded-lg text-on-surface-variant bg-surface-container-high hover:text-on-surface transition-colors">
                    <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
                    Question
                  </button>
                  <button onClick={() => setShowArchiveConfirm(true)}
                    className="flex items-center justify-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wider rounded-lg text-error/60 hover:text-error hover:bg-error-container/20 transition-colors">
                    <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                    Archive
                  </button>
                  <button
                    onClick={() => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); handleSave(content); }}
                    disabled={!hasUnsavedChanges || isSaving}
                    className="flex items-center justify-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wider rounded-lg luminous-pulse text-on-primary disabled:opacity-50 transition-all">
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Save
                  </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.includes(ext);
}
