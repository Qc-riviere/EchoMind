import { IlinkBotAPI } from "./api.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  OutboundMessage,
  WeixinMessage,
} from "./types.js";

const MAX_MSG_LEN = 2048;
const MAX_RETRIES = 3;

let clientIdCounter = 0;

function nextClientId(): string {
  return `em-${Date.now()}-${++clientIdCounter}`;
}

export class MessageSender {
  private api: IlinkBotAPI;
  private botAccountId: string;

  constructor(api: IlinkBotAPI, botAccountId: string) {
    this.api = api;
    this.botAccountId = botAccountId;
  }

  /**
   * Send a text reply to the user. Automatically chunks long messages.
   */
  async sendText(
    text: string,
    incomingMsg: WeixinMessage,
  ): Promise<void> {
    const chunks = splitMessage(text, MAX_MSG_LEN);
    for (const chunk of chunks) {
      await this.sendSingleText(chunk, incomingMsg);
    }
  }

  private async sendSingleText(
    text: string,
    incomingMsg: WeixinMessage,
  ): Promise<void> {
    const msg: OutboundMessage = {
      from_user_id: this.botAccountId,
      to_user_id: incomingMsg.from_user_id || "",
      client_id: nextClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: incomingMsg.context_token || "",
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text },
        },
      ],
    };

    let backoff = 10_000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const resp = await this.api.sendMessage(msg);
      const ret = resp.ret as number | undefined;
      // Empty response {} or ret===0 means success
      if (ret === undefined || ret === 0) return;

      // Rate limited
      if (ret === -2) {
        console.warn(
          `[sender] Rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${backoff / 1000}s`,
        );
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
        continue;
      }

      // Other error — don't retry
      console.error(`[sender] Send failed: ret=${ret} msg=${resp.retmsg}`);
      return;
    }

    console.error("[sender] Max retries reached, giving up");
  }
}

/**
 * Split text into chunks of maxLen, preferring newline boundaries.
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at a newline in the last 70% of the chunk
    const minSplit = Math.floor(maxLen * 0.3);
    let splitAt = -1;

    for (let i = maxLen - 1; i >= minSplit; i--) {
      if (remaining[i] === "\n") {
        splitAt = i;
        break;
      }
    }

    if (splitAt === -1) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
