/** Bridge-mode client: talks to the VPS bridge server instead of the local EchoMind server. */

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

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
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
    const text = await resp.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!resp.ok) {
      const msg = (data as { error?: string })?.error || text.slice(0, 200);
      throw new Error(`bridge (${resp.status}): ${msg}`);
    }
    return data as T;
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

/** Read bridge config from environment. Returns null if not configured. */
export function bridgeClientFromEnv(): BridgeClient | null {
  const url = process.env.ECHOMIND_BRIDGE_URL;
  const token = process.env.ECHOMIND_BRIDGE_TOKEN;
  if (url && token) {
    return new BridgeClient(url, token);
  }
  return null;
}
