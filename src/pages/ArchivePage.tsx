import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Thought } from "../lib/types";
import ConfirmDialog from "../components/ConfirmDialog";
import ThoughtImage from "../components/ThoughtImage";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.includes(ext);
}

export default function ArchivePage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "week" | "month">("all");
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean; type: "restore" | "delete"; thoughtId: string; thoughtContent: string;
  }>({ isOpen: false, type: "restore", thoughtId: "", thoughtContent: "" });

  const load = () => {
    setLoading(true);
    invoke<Thought[]>("list_archived_thoughts").then(setThoughts).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleUnarchive = (id: string) => {
    const t = thoughts.find((t) => t.id === id);
    if (!t) return;
    setConfirmDialog({ isOpen: true, type: "restore", thoughtId: id, thoughtContent: t.content.slice(0, 50) });
  };

  const handleDelete = (id: string) => {
    const t = thoughts.find((t) => t.id === id);
    if (!t) return;
    setConfirmDialog({ isOpen: true, type: "delete", thoughtId: id, thoughtContent: t.content.slice(0, 50) });
  };

  const confirmAction = async () => {
    const { type, thoughtId } = confirmDialog;
    try {
      if (type === "restore") await invoke("unarchive_thought", { id: thoughtId });
      else await invoke("delete_thought", { id: thoughtId });
      setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));
    } catch (e) {
      alert(`操作失败: ${e}`);
    } finally {
      setConfirmDialog({ isOpen: false, type: "restore", thoughtId: "", thoughtContent: "" });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-8 py-12">
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.type === "restore" ? "确认恢复" : "确认永久删除"}
        message={
          confirmDialog.type === "restore"
            ? "确定要恢复这条灵感吗？它将重新出现在主列表中。"
            : `确定要永久删除"${confirmDialog.thoughtContent}..."吗？此操作不可撤销。`
        }
        confirmText={confirmDialog.type === "restore" ? "恢复" : "删除"}
        cancelText="取消"
        variant={confirmDialog.type === "delete" ? "danger" : "info"}
        icon={confirmDialog.type === "restore" ? "restore" : "delete"}
        onConfirm={confirmAction}
        onCancel={() => setConfirmDialog({ isOpen: false, type: "restore", thoughtId: "", thoughtContent: "" })}
      />

      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-headline font-bold text-on-surface tracking-tight">The Attic of Thought</h1>
        <p className="text-sm text-on-surface-variant mt-3 leading-relaxed max-w-2xl">
          Manage discarded inspirations and forgotten reflections. These cognitive fragments are held here until you choose to restore their place in your mind or let them go forever.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center justify-between mb-8">
        <span className="text-[10px] text-on-surface-variant uppercase tracking-widest font-mono">Filter by Recency</span>
        <div className="flex gap-1">
          {(["all", "week", "month"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all ${
                filter === f ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-on-surface-variant gap-3">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          正在加载归档...
        </div>
      )}

      {/* Empty */}
      {!loading && thoughts.length === 0 && (
        <div className="text-center py-20 space-y-4 bg-surface-container-low rounded-2xl">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/30">inventory_2</span>
          <div>
            <p className="text-lg font-headline font-semibold text-on-surface">暂无归档内容</p>
            <p className="text-on-surface-variant text-sm mt-1">归档的思想会显示在这里</p>
          </div>
        </div>
      )}

      {/* Archive cards - horizontal layout */}
      <div className="flex flex-col gap-4">
        {thoughts.filter((thought) => {
          if (filter === "all") return true;
          const date = new Date(thought.updated_at);
          const now = new Date();
          if (filter === "week") {
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return date >= oneWeekAgo;
          }
          if (filter === "month") {
            const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            return date >= oneMonthAgo;
          }
          return true;
        }).map((thought) => {
          const hasImg = thought.image_path && isImageFile(thought.image_path);
          const dateStr = new Date(thought.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();

          return (
            <div
              key={thought.id}
              className="group flex items-center gap-6 bg-surface-container-lowest rounded-2xl p-6 transition-all hover:bg-surface-container-low"
            >
              {/* Thumbnail */}
              <div className="w-28 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-container-high flex items-center justify-center">
                {hasImg ? (
                  <ThoughtImage filename={thought.image_path!} className="w-full h-full object-cover" />
                ) : (
                  <span className="material-symbols-outlined text-on-surface-variant/30">description</span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  {thought.domain && (
                    <span className="text-[10px] text-primary uppercase tracking-wider font-bold">{thought.domain}</span>
                  )}
                  <span className="text-[10px] text-on-surface-variant/40 font-mono">ARCHIVED {dateStr}</span>
                </div>
                <h4 className="text-base font-headline font-semibold text-on-surface truncate">{thought.content}</h4>
                {thought.context && (
                  <p className="text-xs text-on-surface-variant/80 mt-1 truncate">{thought.context}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 shrink-0">
                <button
                  onClick={() => handleUnarchive(thought.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">restore</span>
                  Restore
                </button>
                <button
                  onClick={() => handleDelete(thought.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg text-error/60 hover:text-error hover:bg-error-container/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
