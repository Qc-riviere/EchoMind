import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startQrLogin, pollQrStatus } from "./api.js";
import { AccountData } from "./types.js";
import { encryptString, decryptString } from "./token-crypto.js";

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

  const QRCode = await import("qrcode");

  try {
    const terminalQr = await QRCode.toString(qrcodeUrl, {
      type: "terminal",
      small: true,
    });
    console.log("\nScan this QR code with WeChat:\n");
    console.log(terminalQr);
  } catch {
    console.log("\nFailed to render QR in terminal. Open this link:");
    console.log(qrcodeUrl);
  }

  // Also save PNG for environments with a GUI (silently ignored on headless).
  const qrImagePath = path.join(os.tmpdir(), "echomind-wechat-qr.png");
  try {
    const pngData = await QRCode.toBuffer(qrcodeUrl, {
      type: "png",
      width: 400,
      margin: 2,
    });
    fs.writeFileSync(qrImagePath, pngData);
    console.log(`(QR also saved to: ${qrImagePath})`);
  } catch {
    // ignore
  }

  console.log("\nScan the QR code with WeChat, then confirm on your phone.");

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
          `${sanitizeId(account.accountId)}.enc`,
        );
        const envelope = await encryptString(JSON.stringify(account));
        fs.writeFileSync(filePath, envelope, { mode: 0o600 });

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
 *
 * Reads `.enc` (encrypted via /api/token/decrypt) or legacy `.json` (plaintext)
 * — for plaintext, transparently re-encrypts on read so the next login already
 * lives in the new format.
 */
export async function loadLatestAccount(): Promise<AccountData | null> {
  ensureDirs();

  const files = fs
    .readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith(".enc") || f.endsWith(".json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(ACCOUNTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return null;

  const filePath = path.join(ACCOUNTS_DIR, files[0].name);
  const raw = fs.readFileSync(filePath, "utf-8");

  if (files[0].name.endsWith(".enc")) {
    const plaintext = await decryptString(raw.trim());
    return JSON.parse(plaintext) as AccountData;
  }

  // Legacy plaintext JSON — migrate to .enc and unlink the old file.
  const account = JSON.parse(raw) as AccountData;
  try {
    const envelope = await encryptString(JSON.stringify(account));
    const encPath = filePath.replace(/\.json$/, ".enc");
    fs.writeFileSync(encPath, envelope, { mode: 0o600 });
    fs.unlinkSync(filePath);
    console.log(`Migrated ${files[0].name} → ${path.basename(encPath)}`);
  } catch (e) {
    console.warn(`Could not migrate plaintext account ${files[0].name}: ${e}`);
  }
  return account;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
