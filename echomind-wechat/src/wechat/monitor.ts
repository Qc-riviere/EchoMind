import { IlinkBotAPI } from "./api.js";
import { WeixinMessage, MessageType, MessageState } from "./types.js";

const MAX_DEDUP_IDS = 1000;

export type MessageCallback = (msg: WeixinMessage) => void;

export class MessageMonitor {
  private api: IlinkBotAPI;
  private getUpdatesBuf?: string;
  private seenIds = new Set<number>();
  private running = false;
  private consecutiveErrors = 0;
  private onMessage: MessageCallback;
  private onSessionExpired?: () => void;

  constructor(
    api: IlinkBotAPI,
    onMessage: MessageCallback,
    onSessionExpired?: () => void,
  ) {
    this.api = api;
    this.onMessage = onMessage;
    this.onSessionExpired = onSessionExpired;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const resp = await this.api.getUpdates(this.getUpdatesBuf);

        // Session expired
        if (resp.ret === -14) {
          console.error("[monitor] Session expired (ret=-14)");
          this.onSessionExpired?.();
          this.running = false;
          return;
        }

        // Update sync buffer
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf;
        }

        this.consecutiveErrors = 0;

        // Process messages
        if (resp.msgs) {
          for (const msg of resp.msgs) {
            // Only process user messages that are finished
            if (msg.message_type !== MessageType.USER) continue;
            if (msg.message_state !== MessageState.FINISH && msg.message_state !== MessageState.NEW) continue;

            // Dedup
            if (msg.message_id != null) {
              if (this.seenIds.has(msg.message_id)) continue;
              this.seenIds.add(msg.message_id);
              // Evict oldest half when full
              if (this.seenIds.size > MAX_DEDUP_IDS) {
                const arr = Array.from(this.seenIds);
                for (let i = 0; i < arr.length / 2; i++) {
                  this.seenIds.delete(arr[i]);
                }
              }
            }

            // Fire-and-forget callback
            try {
              this.onMessage(msg);
            } catch (e) {
              console.error("[monitor] Callback error:", e);
            }
          }
        }
      } catch (e) {
        this.consecutiveErrors++;
        const backoff = this.consecutiveErrors < 3 ? 3000 : 30000;
        console.error(
          `[monitor] Poll error (${this.consecutiveErrors}x), backoff ${backoff}ms:`,
          e instanceof Error ? e.message : e,
        );
        await sleep(backoff);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
