import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { buildPlanMarkdown, buildPlanDocxBlob } from "../lib/chatExporters";
import { errorMsg } from "../lib/errorMsg";
import { notify } from "../lib/notify";
import type { Thought } from "../lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  thought: Thought | null;
  plan: string;
  loading: boolean;
  onSavedAsThought?: () => void;
}

export default function ChatPlanModal({ isOpen, onClose, thought, plan, loading, onSavedAsThought }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [savingThought, setSavingThought] = useState(false);

  if (!isOpen) return null;

  const defaultStem = `EchoMind方案-${
    thought
      ? (thought.file_summary || thought.content)
          .split("\n")[0]
          .slice(0, 20)
          .replace(/[\\/:*?"<>|]/g, "")
      : new Date().toISOString().slice(0, 10)
  }`;

  const handleSaveAsThought = async () => {
    if (savingThought || !plan) return;
    setSavingThought(true);
    try {
      const content = `[AI 整理方案]\n\n${plan.trim()}`;
      const created = await invoke<{ id: string }>("create_thought", { content });
      // Fire-and-forget enrich + embed so the new thought picks up tags/domain.
      invoke("enrich_thought", { thoughtId: created.id })
        .then(() => invoke("embed_thought", { thoughtId: created.id }))
        .catch((err) => console.error("[plan] enrich/embed failed:", err));
      await notify("EchoMind", "方案已保存为新灵感");
      onSavedAsThought?.();
      onClose();
    } catch (e) {
      await notify("EchoMind", `保存失败：${errorMsg(e)}`);
    } finally {
      setSavingThought(false);
    }
  };

  const handleExportMd = async () => {
    setExportOpen(false);
    try {
      const path = await save({
        defaultPath: `${defaultStem}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, buildPlanMarkdown(thought, plan));
      await notify("EchoMind", "已导出 Markdown");
    } catch (e) {
      await notify("EchoMind", `导出失败：${errorMsg(e)}`);
    }
  };

  const handleExportDocx = async () => {
    setExportOpen(false);
    try {
      const path = await save({
        defaultPath: `${defaultStem}.docx`,
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });
      if (!path) return;
      const bytes = await buildPlanDocxBlob(thought, plan);
      await writeFile(path, bytes);
      await notify("EchoMind", "已导出 DOCX");
    } catch (e) {
      await notify("EchoMind", `导出失败：${errorMsg(e)}`);
    }
  };

  const handleExportPdf = () => {
    setExportOpen(false);
    window.print();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[70] w-full max-w-3xl max-h-[80vh] flex flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 overflow-hidden shadow-2xl print:relative print:top-0 print:max-h-none print:rounded-none print:border-0 print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 print:hidden">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">description</span>
            <h2 className="font-headline font-semibold text-on-surface">方案文档</h2>
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 print:overflow-visible">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-1/3" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-3/4" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-5/6" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-1/2" />
              <p className="text-xs text-on-surface-variant/60 mt-4">AI 正在整理对话…</p>
            </div>
          ) : (
            <article className="prose prose-sm max-w-none text-on-surface whitespace-pre-wrap leading-relaxed">
              {plan || <span className="text-on-surface-variant/60">（暂无内容）</span>}
            </article>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/10 print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            关闭
          </button>
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={loading || !plan}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-highest text-on-surface text-sm font-medium hover:text-primary disabled:opacity-40 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              导出
              <span className="material-symbols-outlined text-[16px]">expand_more</span>
            </button>
            {exportOpen && (
              <div className="absolute bottom-full mb-2 right-0 bg-surface-container-high rounded-xl border border-outline-variant/20 shadow-xl overflow-hidden min-w-[140px]">
                <button onClick={handleExportMd} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-highest transition-colors">Markdown</button>
                <button onClick={handleExportDocx} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-highest transition-colors">DOCX</button>
                <button onClick={handleExportPdf} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-highest transition-colors">PDF（打印）</button>
              </div>
            )}
          </div>
          <button
            onClick={handleSaveAsThought}
            disabled={loading || !plan || savingThought}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {savingThought ? (
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[18px]">save</span>
            )}
            保存为新灵感
          </button>
        </div>
      </div>
    </>
  );
}
