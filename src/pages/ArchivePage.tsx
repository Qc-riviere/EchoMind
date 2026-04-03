import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, RotateCcw, Archive } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Thought } from "../lib/types";
import ConfirmDialog from "../components/ConfirmDialog";

export default function ArchivePage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'restore' | 'delete';
    thoughtId: string;
    thoughtContent: string;
  }>({ isOpen: false, type: 'restore', thoughtId: '', thoughtContent: '' });

  const load = () => {
    setLoading(true);
    invoke<Thought[]>("list_archived_thoughts")
      .then(setThoughts)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleUnarchive = async (id: string) => {
    const thought = thoughts.find(t => t.id === id);
    if (!thought) return;
    setConfirmDialog({
      isOpen: true,
      type: 'restore',
      thoughtId: id,
      thoughtContent: thought.content.slice(0, 50)
    });
  };

  const handleDelete = async (id: string) => {
    const thought = thoughts.find(t => t.id === id);
    if (!thought) return;
    setConfirmDialog({
      isOpen: true,
      type: 'delete',
      thoughtId: id,
      thoughtContent: thought.content.slice(0, 50)
    });
  };

  const confirmAction = async () => {
    const { type, thoughtId } = confirmDialog;
    try {
      if (type === 'restore') {
        await invoke("unarchive_thought", { id: thoughtId });
        setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));
      } else if (type === 'delete') {
        await invoke("delete_thought", { id: thoughtId });
        setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));
      }
    } catch (e) {
      console.error("Action failed:", e);
      alert(`操作失败: ${e}`);
    } finally {
      setConfirmDialog({ isOpen: false, type: 'restore', thoughtId: '', thoughtContent: '' });
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.type === 'restore' ? '确认恢复' : '确认永久删除'}
        message={
          confirmDialog.type === 'restore'
            ? `确定要恢复这条灵感吗？它将重新出现在主列表中。`
            : `确定要永久删除"${confirmDialog.thoughtContent}..."吗？此操作不可撤销。`
        }
        confirmText={confirmDialog.type === 'restore' ? '恢复' : '删除'}
        cancelText="取消"
        variant={confirmDialog.type === 'delete' ? 'danger' : 'info'}
        icon={confirmDialog.type === 'restore' ? 'restore' : 'delete'}
        onConfirm={confirmAction}
        onCancel={() => setConfirmDialog({ isOpen: false, type: 'restore', thoughtId: '', thoughtContent: '' })}
      />

      <div className="flex justify-center w-full">
        <div className="w-full max-w-3xl">
          <div className="space-y-8 py-8">
            <div className="pt-4">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#575b8c] to-[#8a8dc4] font-[Manrope] tracking-tight">
                归档
              </h1>
              <p className="text-[#7a7a84] mt-2 font-medium">
                已归档的思想，可恢复或永久删除。
              </p>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-16 text-[#7a7a84] gap-3">
                <div className="w-5 h-5 border-2 border-[#575b8c]/30 border-t-[#575b8c] rounded-full animate-spin" />
                正在加载归档...
              </div>
            )}

            {!loading && thoughts.length === 0 && (
              <div className="text-center py-20 space-y-4 bg-white/40 backdrop-blur-sm rounded-3xl border border-white/60 shadow-sm">
                <Archive className="w-16 h-16 mx-auto text-[#c1c5fd] drop-shadow-md" />
                <div>
                  <p className="text-lg font-medium text-[#575b8c]">暂无归档内容</p>
                  <p className="text-[#a1a1aa] mt-1">归档的思想会显示在这里</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {thoughts.map((thought) => (
                <div
                  key={thought.id}
                  className="group cursor-pointer rounded-2xl p-5 transition-all duration-400 ease-[cubic-bezier(0.25,0.8,0.25,1)] border bg-white/70 backdrop-blur-sm shadow-[0_4px_16px_rgba(87,91,140,0.04)] border-white/60 hover:bg-white hover:shadow-[0_12px_40px_-8px_rgba(87,91,140,0.2)] hover:-translate-y-1.5"
                >
                  <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[#31323b] leading-relaxed mb-3 text-lg">
                        {thought.content}
                      </p>
                      
                      {thought.context && (
                        <div className="mb-4">
                          <div className="bg-gradient-to-r from-[#f4f0fa] to-white/50 rounded-2xl p-4 border border-[#e3e1ed]/60 shadow-sm relative overflow-hidden">
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
                      
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[#a1a1aa] font-medium">
                          {formatDistanceToNow(new Date(thought.updated_at), { addSuffix: true, locale: zhCN })}
                        </span>
                        {thought.domain && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-[#f6d0fd]/50 text-[#855392] font-medium border border-[#f6d0fd]">
                            {thought.domain}
                          </span>
                        )}
                        {thought.tags && thought.tags.split(",").map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2.5 py-1 rounded-full bg-[#f4f0fa] text-[#6b6e8a] border border-[#e3e1ed]"
                          >
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => handleUnarchive(thought.id)}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl text-[#575b8c] bg-[#c1c5fd]/20 hover:bg-[#c1c5fd]/30 transition-colors"
                        title="恢复到主列表"
                      >
                        <RotateCcw className="w-4 h-4" />
                        恢复
                      </button>
                      <button
                        onClick={() => handleDelete(thought.id)}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl text-[#a8364b] bg-[#f97386]/10 hover:bg-[#f97386]/20 transition-colors"
                        title="永久删除"
                      >
                        <Trash2 className="w-4 h-4" />
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
