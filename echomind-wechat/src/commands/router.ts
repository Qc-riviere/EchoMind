import { EchoMindClient } from "../echomind/client.js";
import { Thought } from "../echomind/types.js";
import { describeImage } from "../echomind/vision.js";
import { downloadImage } from "../wechat/media.js";
import { getSession, updateSession, clearSession } from "../session.js";
import type { ImageItem } from "../wechat/types.js";

const client = new EchoMindClient();

// ── Command dispatch ─────────────────────────────────────

export interface CommandResult {
  text: string;
  /** If set, send this first as a "pending" indicator before the main text */
  pending?: string;
}

export async function handleMessage(
  userId: string,
  text: string,
): Promise<CommandResult> {
  const trimmed = text.trim();
  const session = getSession(userId);

  // Slash commands always take priority
  if (trimmed.startsWith("/")) {
    return handleCommand(userId, trimmed);
  }

  // If in chatting state, forward to AI conversation
  if (session.state === "chatting" && session.conversationId) {
    return { pending: "🤔 思考中...", ...(await handleChatReply(userId, session.conversationId, trimmed)) };
  }

  // Default: capture as a new thought
  return handleCapture(userId, trimmed);
}

// ── Image message handler ───────────────────────────────

export async function handleImageMessage(
  userId: string,
  imageItem: ImageItem,
): Promise<CommandResult> {
  try {
    // Download and decrypt image from WeChat CDN
    const dataUri = await downloadImage(imageItem);
    if (!dataUri) {
      return { text: "无法下载图片，请重试" };
    }

    // Save image file to data directory
    const imagePath = await saveImageFile(dataUri);

    // Use LLM vision to describe image
    let description: string;
    try {
      description = await describeImage(dataUri);
    } catch (e) {
      description = "图片（AI 描述失败）";
      console.error("[image-capture] vision error:", e);
    }

    // Save as thought with image path
    const content = `[图片识别] ${description}`;
    const thought = await client.createThoughtWithImage(content, imagePath);

    // Fire-and-forget: enrich + embed
    enrichAndEmbed(thought.id).catch((e) =>
      console.error("[image-capture] enrich/embed error:", e),
    );

    return {
      text: `✓ 图片已识别并记录\n\n${description}`,
    };
  } catch (e) {
    return { text: `图片处理失败: ${errorMsg(e)}` };
  }
}

async function saveImageFile(dataUri: string): Promise<string> {
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URI");
  const [, ext, base64Data] = match;

  const { default: path } = await import("node:path");
  const { default: fs } = await import("node:fs");
  const { default: os } = await import("node:os");

  // Save to the same data directory as echomind
  const dataDir = path.join(
    os.platform() === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "com.fu-qianchen.echomind")
      : path.join(os.homedir(), ".local", "share", "com.fu-qianchen.echomind"),
    "images",
  );
  fs.mkdirSync(dataDir, { recursive: true });

  const filename = `wechat-${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
  const filePath = path.join(dataDir, filename);
  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

  // Return just the filename — server will serve from images dir
  return filename;
}

// ── Slash command router ─────────────────────────────────

async function handleCommand(
  userId: string,
  input: string,
): Promise<CommandResult> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");

  switch (cmd) {
    case "list":
      return cmdList(args);
    case "search":
    case "s":
      return cmdSearch(args);
    case "chat":
    case "c":
      return cmdChat(userId, args);
    case "exit":
    case "quit":
    case "q":
      return cmdExit(userId);
    case "archive":
      return cmdArchive(args);
    case "view":
    case "v":
      return cmdView(args);
    case "status":
      return cmdStatus();
    case "help":
    case "h":
      return cmdHelp();
    default:
      return { text: `未知命令: /${cmd}\n发送 /help 查看可用命令` };
  }
}

// ── Command implementations ──────────────────────────────

async function cmdList(args: string): Promise<CommandResult> {
  const n = parseInt(args) || 10;
  try {
    const thoughts = await client.listThoughts(n);
    if (thoughts.length === 0) {
      return { text: "暂无想法记录。发送任意文字开始记录！" };
    }

    const lines = thoughts.map((t, i) => {
      const tags = t.tags ? ` | ${t.tags}` : "";
      const preview = t.content.length > 50
        ? t.content.slice(0, 50) + "..."
        : t.content;
      return `${i + 1}. ${preview}${tags}\n   ID: ${t.id.slice(0, 8)}`;
    });

    return { text: `最近 ${thoughts.length} 条想法：\n\n${lines.join("\n\n")}` };
  } catch (e) {
    return { text: `获取列表失败: ${errorMsg(e)}` };
  }
}

async function cmdSearch(query: string): Promise<CommandResult> {
  if (!query) {
    return { text: "用法: /search <关键词>\n例如: /search AI产品" };
  }

  try {
    const results = await client.search(query);
    if (results.length === 0) {
      return { text: `未找到与「${query}」相关的想法` };
    }

    const lines = results.slice(0, 5).map((t, i) => {
      const preview = t.content.length > 60
        ? t.content.slice(0, 60) + "..."
        : t.content;
      return `${i + 1}. ${preview}\n   ID: ${t.id.slice(0, 8)}`;
    });

    return {
      text: `搜索「${query}」找到 ${results.length} 条相关想法：\n\n${lines.join("\n\n")}`,
    };
  } catch (e) {
    return { text: `搜索失败: ${errorMsg(e)}` };
  }
}

async function cmdChat(userId: string, args: string): Promise<CommandResult> {
  const idPrefix = args.trim();
  if (!idPrefix) {
    return { text: "用法: /chat <想法ID前缀>\n例如: /chat a1b2c3d4\n\n先用 /list 查看想法列表" };
  }

  try {
    // Find thought by ID prefix
    const thought = await findThoughtByPrefix(idPrefix);
    if (!thought) {
      return { text: `未找到 ID 以「${idPrefix}」开头的想法` };
    }

    const conv = await client.startChat(thought.id);

    updateSession(userId, {
      state: "chatting",
      conversationId: conv.id,
      thoughtId: thought.id,
    });

    const preview = thought.content.length > 40
      ? thought.content.slice(0, 40) + "..."
      : thought.content;

    return {
      text: `进入对话模式\n灵感：「${preview}」\n\n直接发送文字与 AI 深度探讨\n发送 /exit 退出对话`,
    };
  } catch (e) {
    return { text: `开始对话失败: ${errorMsg(e)}` };
  }
}

async function cmdExit(userId: string): Promise<CommandResult> {
  clearSession(userId);
  return { text: "已退出对话模式。发送文字记录新想法，或用 /help 查看命令" };
}

async function cmdArchive(args: string): Promise<CommandResult> {
  const idPrefix = args.trim();
  if (!idPrefix) {
    return { text: "用法: /archive <想法ID前缀>" };
  }

  try {
    const thought = await findThoughtByPrefix(idPrefix);
    if (!thought) {
      return { text: `未找到 ID 以「${idPrefix}」开头的想法` };
    }

    await client.archiveThought(thought.id);
    const preview = thought.content.length > 30
      ? thought.content.slice(0, 30) + "..."
      : thought.content;
    return { text: `已归档：「${preview}」` };
  } catch (e) {
    return { text: `归档失败: ${errorMsg(e)}` };
  }
}

async function cmdView(args: string): Promise<CommandResult> {
  const idPrefix = args.trim();
  if (!idPrefix) {
    return { text: "用法: /view <想法ID前缀>" };
  }

  try {
    const thought = await findThoughtByPrefix(idPrefix);
    if (!thought) {
      return { text: `未找到 ID 以「${idPrefix}」开头的想法` };
    }

    let text = `${thought.content}`;
    if (thought.context) text += `\n\n背景: ${thought.context}`;
    if (thought.domain) text += `\n领域: ${thought.domain}`;
    if (thought.tags) text += `\n标签: ${thought.tags}`;
    text += `\n\n创建于: ${thought.created_at}`;
    text += `\nID: ${thought.id}`;

    return { text };
  } catch (e) {
    return { text: `查看失败: ${errorMsg(e)}` };
  }
}

async function cmdStatus(): Promise<CommandResult> {
  try {
    const s = await client.status();
    return {
      text: `EchoMind 状态\n想法: ${s.thoughts} 条\n归档: ${s.archived} 条\n对话: ${s.conversations} 个`,
    };
  } catch (e) {
    return { text: `获取状态失败: ${errorMsg(e)}\n请确认 echomind-server 正在运行` };
  }
}

function cmdHelp(): CommandResult {
  return {
    text: `EchoMind 微信助手

直接发送文字 → 记录想法
在对话中发送文字 → 与 AI 深度探讨

命令列表:
/list [n]     列出最近 n 条想法
/search <词>  语义搜索想法
/view <ID>    查看想法详情
/chat <ID>    开始 AI 深度对话
/exit         退出对话模式
/archive <ID> 归档想法
/status       系统状态
/help         显示此帮助`,
  };
}

// ── Capture (default action) ─────────────────────────────

async function handleCapture(
  userId: string,
  content: string,
): Promise<CommandResult> {
  try {
    const thought = await client.createThought(content);

    // Fire-and-forget: enrich + embed
    enrichAndEmbed(thought.id).catch((e) =>
      console.error("[capture] enrich/embed error:", e),
    );

    let relatedHint = "";
    try {
      // Attempt to find related (may fail if no embeddings yet)
      const related = await client.search(content);
      if (related.length > 0) {
        const previews = related
          .slice(0, 3)
          .map((t) => t.content.slice(0, 30))
          .join("、");
        relatedHint = `\n发现 ${related.length} 条相关想法: ${previews}`;
      }
    } catch {
      // Ignore search errors for new captures
    }

    return {
      text: `✓ 已记录${relatedHint}`,
    };
  } catch (e) {
    return { text: `记录失败: ${errorMsg(e)}` };
  }
}

async function enrichAndEmbed(thoughtId: string): Promise<void> {
  await client.enrichThought(thoughtId);
  await client.embedThought(thoughtId);
}

// ── Chat reply ───────────────────────────────────────────

async function handleChatReply(
  userId: string,
  conversationId: string,
  content: string,
): Promise<CommandResult> {
  try {
    const reply = await client.sendMessage(conversationId, content);
    updateSession(userId, {});
    return { text: reply };
  } catch (e) {
    // Auto-exit chatting on persistent errors (e.g. conversation not found)
    clearSession(userId);
    return {
      text: `AI 回复失败: ${errorMsg(e)}\n已自动退出对话模式。发送文字记录想法，或 /chat <ID> 重新开始对话`,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────

async function findThoughtByPrefix(prefix: string): Promise<Thought | null> {
  // First try exact match
  try {
    return await client.getThought(prefix);
  } catch {
    // Not an exact match, search by prefix in list
  }

  const thoughts = await client.listThoughts(100);
  return thoughts.find((t) => t.id.startsWith(prefix)) || null;
}

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
