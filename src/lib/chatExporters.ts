import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type { ChatMessage, Thought } from "./types";

function firstLine(s: string, max = 80): string {
  return s.split("\n")[0].slice(0, max);
}

export function buildChatMarkdown(thought: Thought | null, messages: ChatMessage[]): string {
  const date = new Date().toLocaleString("zh-CN");
  const lines: string[] = [];
  lines.push(`# 对话记录`);
  lines.push("");
  lines.push(`*生成于 ${date}*`);
  if (thought) {
    lines.push("");
    lines.push(`> 关联灵感：${firstLine(thought.file_summary || thought.content)}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  messages
    .filter((m) => !m.withdrawn)
    .forEach((m) => {
      const speaker = m.role === "user" ? "我" : "EchoMind";
      lines.push(`### ${speaker}`);
      lines.push("");
      lines.push(m.content);
      lines.push("");
    });
  return lines.join("\n");
}

/// Wrap an AI-synthesized plan markdown with a standard header so the saved
/// file is self-describing (date + which inspiration it came from).
export function buildPlanMarkdown(thought: Thought | null, planMarkdown: string): string {
  const date = new Date().toLocaleString("zh-CN");
  const lines: string[] = [];
  lines.push(`# 方案文档`);
  lines.push("");
  lines.push(`*生成于 ${date}*`);
  if (thought) {
    lines.push("");
    lines.push(`> 来自灵感：${firstLine(thought.file_summary || thought.content)}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(planMarkdown.trim());
  return lines.join("\n");
}

export async function buildPlanDocxBlob(
  thought: Thought | null,
  planMarkdown: string,
): Promise<Uint8Array> {
  const date = new Date().toLocaleString("zh-CN");
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("方案文档")] }),
    new Paragraph({ children: [new TextRun({ text: `生成于 ${date}`, italics: true })] }),
  );
  if (thought) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `来自灵感：${firstLine(thought.file_summary || thought.content)}`,
            italics: true,
          }),
        ],
      }),
    );
  }
  children.push(new Paragraph({}));
  // Minimal markdown → docx: detect ##/### headings and bullet lines so the
  // exported doc isn't a wall of identical paragraphs. Anything else passes
  // through as plain text.
  for (const raw of planMarkdown.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(line.slice(3))],
        }),
      );
    } else if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun(line.slice(4))],
        }),
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      children.push(
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun(line.slice(2))] }),
      );
    } else {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export async function buildChatDocxBlob(
  thought: Thought | null,
  messages: ChatMessage[],
): Promise<Uint8Array> {
  const date = new Date().toLocaleString("zh-CN");
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("对话记录")] }),
    new Paragraph({ children: [new TextRun({ text: `生成于 ${date}`, italics: true })] }),
  );
  if (thought) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `关联灵感：${firstLine(thought.file_summary || thought.content)}`,
            italics: true,
          }),
        ],
      }),
    );
  }
  children.push(new Paragraph({}));
  messages
    .filter((m) => !m.withdrawn)
    .forEach((m) => {
      const speaker = m.role === "user" ? "我" : "EchoMind";
      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(speaker)] }),
      );
      for (const line of m.content.split("\n")) {
        children.push(new Paragraph({ children: [new TextRun(line)] }));
      }
      children.push(new Paragraph({}));
    });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}
