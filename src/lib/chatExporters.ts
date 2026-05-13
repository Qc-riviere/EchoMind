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
