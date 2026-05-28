/** Bridge-mode client: talks to the VPS bridge server instead of the local EchoMind server. */

import fs from "node:fs";
import path from "node:path";

export interface BridgeThought {
  id: string;
  content: string;
  domain?: string | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface BridgeChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface BridgeChatResult {
  content: string;
  cost_cents: number;
  usage_cents: number;
  llm_disabled: boolean;
}

export class BridgeClient {
  private baseUrl: string;
  private token: string;
  /** If set, refreshed tokens (server-side sliding TTL via X-Refresh-Token
   *  header) are persisted here so restarts pick up the rotated value
   *  instead of falling back to the original stale env value. */
  private tokenPath?: string;

  constructor(baseUrl: string, token: string, tokenPath?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.tokenPath = tokenPath;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Capture sliding-TTL refresh BEFORE error handling — server only
    // sets this header on successful authed responses.
    this.captureRefresh(resp);
    const text = await resp.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!resp.ok) {
      const msg = (data as { error?: string })?.error || text.slice(0, 200);
      throw new Error(`bridge (${resp.status}): ${msg}`);
    }
    return data as T;
  }

  private captureRefresh(resp: Response): void {
    const fresh = resp.headers.get("x-refresh-token");
    if (!fresh || fresh === this.token) return;
    this.token = fresh;
    if (!this.tokenPath) return;
    try {
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
      // Write atomically: write to .tmp first then rename, so a crash
      // mid-write doesn't leave the bot with a half-written token file
      // that would brick auth on restart.
      const tmp = this.tokenPath + ".tmp";
      fs.writeFileSync(tmp, fresh, { mode: 0o600 });
      fs.renameSync(tmp, this.tokenPath);
    } catch (e) {
      console.warn(`[bridge] failed to persist refreshed token: ${(e as Error).message}`);
    }
  }

  async listThoughts(limit = 20): Promise<BridgeThought[]> {
    const data = await this.request<{ thoughts: BridgeThought[] }>(
      "GET",
      `/bridge/thoughts?limit=${limit}`,
    );
    return data.thoughts;
  }

  async searchThoughts(query: string, limit = 10): Promise<BridgeThought[]> {
    const data = await this.request<{ thoughts: BridgeThought[] }>(
      "POST",
      "/bridge/thoughts/search",
      { query, limit },
    );
    return data.thoughts;
  }

  async captureThought(content: string, tags?: string[]): Promise<{ id: string; content: string; created_at: string }> {
    return this.request("POST", "/bridge/thoughts/capture", { content, tags });
  }

  async chat(messages: BridgeChatMsg[]): Promise<BridgeChatResult> {
    return this.request<BridgeChatResult>("POST", "/bridge/chat", { messages });
  }

  async status(): Promise<{ has_llm_config: boolean; llm_disabled: boolean; usage_cents: number; budget_cents: number | null }> {
    return this.request("GET", "/bridge/status");
  }
}

/** Read bridge config from environment. Returns null if not configured.
 *
 *  Token resolution order (newest wins):
 *    1. Persisted refresh file (if exists and non-empty) — set by previous
 *       runs via sliding TTL.
 *    2. ECHOMIND_BRIDGE_TOKEN env var — initial value from .env at first
 *       deploy.
 *
 *  Persisted path defaults to `${ECHOMIND_BRIDGE_DATA_DIR}/.bridge-token`
 *  (typically /data in the Docker bot container, where bot_data volume
 *  is mounted). Override with ECHOMIND_BRIDGE_TOKEN_PATH for testing.
 */
export function bridgeClientFromEnv(): BridgeClient | null {
  const url = process.env.ECHOMIND_BRIDGE_URL;
  const envToken = process.env.ECHOMIND_BRIDGE_TOKEN;
  if (!url || !envToken) return null;

  const tokenPath =
    process.env.ECHOMIND_BRIDGE_TOKEN_PATH ||
    path.join(process.env.ECHOMIND_BRIDGE_DATA_DIR || "/data", ".bridge-token");

  let token = envToken;
  try {
    if (fs.existsSync(tokenPath)) {
      const persisted = fs.readFileSync(tokenPath, "utf8").trim();
      if (persisted) {
        token = persisted;
        console.log(`[bridge] using persisted refreshed token from ${tokenPath}`);
      }
    }
  } catch (e) {
    console.warn(`[bridge] failed to read persisted token (${(e as Error).message}); falling back to env`);
  }

  return new BridgeClient(url, token, tokenPath);
}
