import { Thought, Conversation, Message, StatusInfo } from "./types.js";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

export class EchoMindClient {
  private baseUrl: string;

  constructor(serverUrl?: string) {
    this.baseUrl = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);

    // 204 No Content — no body to parse
    if (resp.status === 204) {
      if (!resp.ok) throw new Error(`API error (${resp.status})`);
      return undefined as T;
    }

    const text = await resp.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!resp.ok) {
      const errMsg = (data as { error?: string })?.error || text.slice(0, 200);
      throw new Error(`API error (${resp.status}): ${errMsg}`);
    }

    return data as T;
  }

  // ── Thoughts ───────────────────────────────────────────

  async createThought(content: string): Promise<Thought> {
    return this.request("POST", "/api/thoughts", { content });
  }

  async createThoughtWithImage(content: string, imagePath: string): Promise<Thought> {
    return this.request("POST", "/api/thoughts", { content, image_path: imagePath });
  }

  async listThoughts(limit = 10, offset = 0): Promise<Thought[]> {
    return this.request("GET", `/api/thoughts?limit=${limit}&offset=${offset}`);
  }

  async getThought(id: string): Promise<Thought> {
    return this.request("GET", `/api/thoughts/${id}`);
  }

  async updateThought(id: string, content: string): Promise<Thought> {
    return this.request("PUT", `/api/thoughts/${id}`, { content });
  }

  async archiveThought(id: string): Promise<void> {
    await this.request("POST", `/api/thoughts/${id}/archive`);
  }

  async enrichThought(id: string): Promise<Thought> {
    return this.request("POST", `/api/thoughts/${id}/enrich`);
  }

  async embedThought(id: string): Promise<void> {
    await this.request("POST", `/api/thoughts/${id}/embed`);
  }

  async findRelated(id: string): Promise<Thought[]> {
    return this.request("POST", `/api/thoughts/${id}/related`);
  }

  // ── Conversations ──────────────────────────────────────

  async startChat(thoughtId: string): Promise<Conversation> {
    return this.request("POST", `/api/thoughts/${thoughtId}/chat`);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.request("GET", `/api/conversations/${conversationId}/messages`);
  }

  async sendMessage(conversationId: string, content: string): Promise<string> {
    const data = await this.request<{ reply: string }>(
      "POST",
      `/api/conversations/${conversationId}/messages`,
      { content },
    );
    return data.reply;
  }

  // ── Search & Status ────────────────────────────────────

  async search(query: string): Promise<Thought[]> {
    return this.request("POST", "/api/search", { query });
  }

  async status(): Promise<StatusInfo> {
    return this.request("GET", "/api/status");
  }
}
