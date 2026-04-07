import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startQrLogin, pollQrStatus } from "./api.js";
import { AccountData } from "./types.js";

const DATA_DIR = path.join(os.homedir(), ".echomind-wechat");
const ACCOUNTS_DIR = path.join(DATA_DIR, "accounts");
const QR_POLL_INTERVAL = 3000;

function ensureDirs(): void {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.@=-]/g, "_");
}

/**
 * Full QR login flow: get QR code, wait for scan, save account.
 */
export async function loginFlow(): Promise<AccountData> {
  ensureDirs();

  console.log("Requesting QR code...");
  const { qrcodeId, qrcodeUrl } = await startQrLogin();

  // Generate QR code PNG from the URL and open with system viewer
  const qrImagePath = path.join(os.tmpdir(), "echomind-wechat-qr.png");
  try {
    const QRCode = await import("qrcode");
    const pngData = await QRCode.toBuffer(qrcodeUrl, {
      type: "png",
      width: 400,
      margin: 2,
    });
    fs.writeFileSync(qrImagePath, pngData);

    console.log(`\nQR code saved to: ${qrImagePath}`);
    console.log("Opening QR code image...\n");

    const { exec } = await import("node:child_process");
    const openCmd =
      process.platform === "win32"
        ? `start "" "${qrImagePath}"`
        : process.platform === "darwin"
          ? `open "${qrImagePath}"`
          : `xdg-open "${qrImagePath}"`;
    exec(openCmd);
  } catch {
    // Fallback: print the URL directly
    console.log("\nFailed to generate QR image. Open this link in browser:");
    console.log(qrcodeUrl);
  }

  console.log("Scan the QR code with WeChat, then confirm on your phone.");

  while (true) {
    await sleep(QR_POLL_INTERVAL);

    const result = await pollQrStatus(qrcodeId);

    switch (result.status) {
      case "wait":
        // Still waiting
        break;
      case "scaned":
        console.log("QR scanned! Waiting for confirmation...");
        break;
      case "confirmed": {
        const account: AccountData = {
          botToken: result.botToken!,
          accountId: result.accountId!,
          baseUrl: result.baseUrl!,
          userId: result.userId!,
          createdAt: new Date().toISOString(),
        };

        const filePath = path.join(
          ACCOUNTS_DIR,
          `${sanitizeId(account.accountId)}.json`,
        );
        fs.writeFileSync(filePath, JSON.stringify(account, null, 2), {
          mode: 0o600,
        });

        console.log(`\nLogin successful! Account saved: ${account.accountId}`);
        return account;
      }
      case "expired":
        throw new Error("QR code expired. Please run setup again.");
    }
  }
}

/**
 * Load the most recently modified account.
 */
export function loadLatestAccount(): AccountData | null {
  ensureDirs();

  const files = fs
    .readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(ACCOUNTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return null;

  const data = fs.readFileSync(
    path.join(ACCOUNTS_DIR, files[0].name),
    "utf-8",
  );
  return JSON.parse(data) as AccountData;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
