import { IlinkBotAPI } from "./wechat/api.js";
import { MessageMonitor } from "./wechat/monitor.js";
import { MessageSender } from "./wechat/sender.js";
import { loginFlow, loadLatestAccount } from "./wechat/login.js";
import { MessageItemType, WeixinMessage } from "./wechat/types.js";
import { handleMessage, handleImageMessage } from "./commands/router.js";

// ── Main entry ────────────���──────────────────────────────

const command = process.argv[2] || "daemon";

switch (command) {
  case "setup":
    await runSetup();
    break;
  case "daemon":
    await runDaemon();
    break;
  case "status":
    await runStatus();
    break;
  default:
    console.log("Usage: echomind-wechat [setup|daemon|status]");
    process.exit(1);
}

// ── Setup: QR login ───────────��──────────────────────────

async function runSetup(): Promise<void> {
  console.log("EchoMind WeChat Bridge - Setup\n");
  try {
    const account = await loginFlow();
    console.log(`\nAccount ID: ${account.accountId}`);
    console.log(`\nRun 'npm start' to start the daemon.`);
  } catch (e) {
    console.error("Setup failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

// ── Daemon: message bridge ───────────────────────���───────

async function runDaemon(): Promise<void> {
  const account = loadLatestAccount();
  if (!account) {
    console.error("No account found. Run 'npm run setup' first.");
    process.exit(1);
  }

  console.log(`EchoMind WeChat Bridge`);
  console.log(`Account: ${account.accountId}`);
  console.log(`Server:  http://127.0.0.1:8765`);
  console.log(`Listening for messages...\n`);

  const api = new IlinkBotAPI(account.baseUrl, account.botToken);
  const sender = new MessageSender(api, account.accountId);

  const monitor = new MessageMonitor(
    api,
    (msg) => onMessage(msg, sender),
    () => {
      console.error("\nSession expired! Run 'npm run setup' to re-login.");
      process.exit(1);
    },
  );

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    monitor.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    monitor.stop();
    process.exit(0);
  });

  monitor.start();
}

// ── Message handler ──────────────────────────────────────

async function onMessage(
  msg: WeixinMessage,
  sender: MessageSender,
): Promise<void> {
  const userId = msg.from_user_id || "unknown";
  const text = extractText(msg);
  const imageItem = extractImage(msg);

  // Handle image messages
  if (!text && imageItem) {
    console.log(`[${timestamp()}] ${userId}: [图片]`);
    try {
      await sender.sendText("🖼️ 正在识别图片...", msg);
      const result = await handleImageMessage(userId, imageItem);
      console.log(`[${timestamp()}] → ${result.text.slice(0, 80)}`);
      await sender.sendText(result.text, msg);
    } catch (e) {
      console.error(`[${timestamp()}] Error handling image:`, e);
      await sender.sendText("图片识别失败，请稍后再试", msg).catch(() => {});
    }
    return;
  }

  if (!text) {
    const types = msg.item_list?.map((i) => i.type).join(",") || "none";
    console.log(`[${timestamp()}] ${userId}: (non-text, item types: ${types})`);
    return;
  }

  console.log(`[${timestamp()}] ${userId}: ${text.slice(0, 80)}`);

  try {
    const result = await handleMessage(userId, text);
    // Send pending indicator first (e.g., "thinking...")
    if (result.pending) {
      await sender.sendText(result.pending, msg);
    }
    console.log(`[${timestamp()}] → ${result.text.slice(0, 80)}`);
    await sender.sendText(result.text, msg);
  } catch (e) {
    console.error(`[${timestamp()}] Error handling message:`, e);
    await sender.sendText(
      "处理消息时出错，请稍后再试",
      msg,
    ).catch(() => {});
  }
}

function extractText(msg: WeixinMessage): string | null {
  if (!msg.item_list) return null;

  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
  }

  return null;
}

function extractImage(msg: WeixinMessage): import("./wechat/types.js").ImageItem | null {
  if (!msg.item_list) return null;

  for (const item of msg.item_list) {
    if (item.type === MessageItemType.IMAGE && item.image_item) {
      return item.image_item;
    }
  }

  return null;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

// ── Status check ───��─────────────────────────────────────

async function runStatus(): Promise<void> {
  const account = loadLatestAccount();
  if (!account) {
    console.log("No account configured. Run 'npm run setup'.");
    return;
  }

  console.log(`Account: ${account.accountId}`);
  console.log(`Created: ${account.createdAt}`);

  try {
    const resp = await fetch("http://127.0.0.1:8765/api/status");
    const data = await resp.json();
    console.log(`\nEchoMind Server: online`);
    console.log(`Thoughts: ${(data as Record<string, number>).thoughts}`);
    console.log(`Archived: ${(data as Record<string, number>).archived}`);
    console.log(`Conversations: ${(data as Record<string, number>).conversations}`);
  } catch {
    console.log(`\nEchoMind Server: offline`);
    console.log(`Make sure echomind-server is running on port 8765.`);
  }
}
