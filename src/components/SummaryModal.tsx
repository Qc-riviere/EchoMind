import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { notify } from "../lib/notify";
import type { Thought } from "../lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  thoughts: Thought[];
  summary: string;
  loading: boolean;
  onSavedAsThought?: () => void;
}

function buildMarkdown(thoughts: Thought[], summary: string): string {
  const date = new Date().toLocaleString("zh-CN");
  const lines: string[] = [];
  lines.push(`# 灵感总结`);
  lines.push("");
  lines.push(`*生成于 ${date} · ${thoughts.length} 条灵感*`);
  lines.push("");
  lines.push("## AI 总结");
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("## 来源灵感");
  lines.push("");
  thoughts.forEach((t, i) => {
    lines.push(`### ${i + 1}. ${t.content.split("\n")[0].slice(0, 60)}`);
    if (t.context) lines.push(`> ${t.context}`);
    lines.push("");
    lines.push(t.content);
    if (t.tags) {
      lines.push("");
      lines.push(`**标签：** ${t.tags}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

async function buildDocxBlob(thoughts: Thought[], summary: string): Promise<Uint8Array> {
  const date = new Date().toLocaleString("zh-CN");
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("灵感总结")] }),
    new Paragraph({ children: [new TextRun({ text: `生成于 ${date} · ${thoughts.length} 条灵感`, italics: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("AI 总结")] }),
  );
  for (const line of summary.split("\n")) {
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("来源灵感")] }));
  thoughts.forEach((t, i) => {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(`${i + 1}. ${t.content.split("\n")[0].slice(0, 60)}`)] }),
    );
    if (t.context) {
      children.push(new Paragraph({ children: [new TextRun({ text: t.context, italics: true })] }));
    }
    for (const line of t.content.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
    if (t.tags) {
      children.push(new Paragraph({ children: [new TextRun({ text: `标签：${t.tags}`, bold: true })] }));
    }
    children.push(new Paragraph({}));
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export default function SummaryModal({ isOpen, onClose, thoughts, summary, loading, onSavedAsThought }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [savingThought, setSavingThought] = useState(false);

  if (!isOpen) return null;

  const handleSaveAsThought = async () => {
    if (savingThought || !summary) return;
    setSavingThought(true);
    try {
      const sourceList = thoughts
        .map((t, i) => `${i + 1}. ${t.content.split("\n")[0].slice(0, 60)}`)
        .join("\n");
      const content = `[AI 总结 · ${thoughts.length} 条灵感]\n\n${summary}\n\n---\n来源：\n${sourceList}`;
      await invoke("create_thought", { content });
      await notify("EchoMind", "总结已保存为新灵感");
      onSavedAsThought?.();
      onClose();
    } finally {
      setSavingThought(false);
    }
  };

  const handleExportMd = async () => {
    setExportOpen(false);
    try {
      const path = await save({
        defaultPath: "灵感总结.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, buildMarkdown(thoughts, summary));
      await notify("EchoMind", "已导出 Markdown");
    } catch (e) {
      console.error("Export MD failed:", e);
    }
  };

  const handleExportDocx = async () => {
    setExportOpen(false);
    try {
      const path = await save({
        defaultPath: "灵感总结.docx",
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });
      if (!path) return;
      const bytes = await buildDocxBlob(thoughts, summary);
      await writeFile(path, bytes);
      await notify("EchoMind", "已导出 DOCX");
    } catch (e) {
      console.error("Export DOCX failed:", e);
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 print:hidden">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">auto_awesome</span>
            <h2 className="font-headline font-semibold text-on-surface">AI 总结 · {thoughts.length} 条灵感</h2>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 print:overflow-visible">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 bg-surface-container-high rounded animate-pulse" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-3/4" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-5/6" />
              <div className="h-4 bg-surface-container-high rounded animate-pulse w-1/2" />
            </div>
          ) : (
            <article className="prose prose-sm max-w-none text-on-surface whitespace-pre-wrap leading-relaxed">
              {summary || <span className="text-on-surface-variant/60">（暂无内容）</span>}
            </article>
          )}
        </div>

        {/* Footer */}
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
              disabled={loading || !summary}
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
                <button onClick={handleExportPdf} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container-highest transition-colors">PDF (打印)</button>
              </div>
            )}
          </div>
          <button
            onClick={handleSaveAsThought}
            disabled={loading || !summary || savingThought}
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
