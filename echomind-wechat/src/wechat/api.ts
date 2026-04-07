import crypto from "node:crypto";
import { GetUpdatesResp, OutboundMessage } from "./types.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const POLL_TIMEOUT_MS = 35_000;

export class IlinkBotAPI {
  private baseUrl: string;
  private botToken: string;
  private uin: string;

  constructor(baseUrl: string, botToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "") || DEFAULT_BASE_URL;
    this.botToken = botToken;
    // Random UIN as base64 of 4 random bytes
    this.uin = crypto.randomBytes(4).toString("base64");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.botToken}`,
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.uin,
      "Content-Type": "application/json",
    };
  }

  async getUpdates(getUpdatesBuf?: string): Promise<GetUpdatesResp> {
    const url = `${this.baseUrl}/ilink/bot/getupdates`;
    const body: Record<string, string> = {};
    if (getUpdatesBuf) {
      body.get_updates_buf = getUpdatesBuf;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS + 5000);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await resp.json()) as GetUpdatesResp;
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendMessage(msg: OutboundMessage): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/ilink/bot/sendmessage`;
    const payload = { msg };

    const resp = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error(`[api] sendMessage non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
      return { ret: -999, retmsg: text.slice(0, 200) };
    }
  }
}

// ── Static login helpers (no token needed) ───────────────

export async function startQrLogin(): Promise<{
  qrcodeId: string;
  qrcodeUrl: string;
}> {
  const url = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const resp = await fetch(url);
  const data = (await resp.json()) as {
    ret: number;
    qrcode: string;
    qrcode_img_content: string;
  };
  if (data.ret !== 0 || !data.qrcode_img_content || !data.qrcode) {
    throw new Error(`Failed to get QR code: ret=${data.ret}`);
  }
  return {
    qrcodeId: data.qrcode,
    qrcodeUrl: data.qrcode_img_content,
  };
}

export async function pollQrStatus(qrcodeId: string): Promise<{
  status: "wait" | "scaned" | "confirmed" | "expired";
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
}> {
  const url = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${qrcodeId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    const data = (await resp.json()) as Record<string, string>;
    const status = (data.status || "wait") as "wait" | "scaned" | "confirmed" | "expired";

    if (status === "confirmed") {
      return {
        status,
        botToken: data.bot_token,
        accountId: data.ilink_bot_id,
        baseUrl: data.baseurl || DEFAULT_BASE_URL,
        userId: data.ilink_user_id,
      };
    }
    return { status };
  } finally {
    clearTimeout(timeout);
  }
}
