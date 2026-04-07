import { EchoMindClient } from "./client.js";

const client = new EchoMindClient();

interface LLMSettings {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Fetch LLM settings from echomind-server.
 */
async function getLLMSettings(): Promise<LLMSettings> {
  const resp = await fetch("http://127.0.0.1:8765/api/settings");
  const settings = (await resp.json()) as Record<string, string>;

  const provider = settings["llm_provider"];
  const apiKey = settings["llm_api_key"];
  const model = settings["llm_model"];
  const baseUrl = settings["llm_base_url"];

  if (!provider || !apiKey) {
    throw new Error("LLM 未配置，请先在桌面端设置");
  }

  return { provider, apiKey, model, baseUrl };
}

/**
 * Use LLM vision API to describe an image.
 * Supports OpenAI-compatible, Claude, and Gemini APIs.
 */
export async function describeImage(imageDataUri: string): Promise<string> {
  const settings = await getLLMSettings();

  // Extract base64 and mime from data URI
  const match = imageDataUri.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URI");
  const [, mimeType, base64Data] = match;

  switch (settings.provider) {
    case "openai":
      return describeWithOpenAI(settings, mimeType, base64Data);
    case "claude":
      return describeWithClaude(settings, mimeType, base64Data);
    case "gemini":
      return describeWithGemini(settings, mimeType, base64Data);
    default:
      throw new Error(`不支持的 LLM 提供商: ${settings.provider}`);
  }
}

const VISION_PROMPT = "请用中文简洁描述这张图片的内容，提取关键信息。如果图片包含文字，请识别并列出。用一段话总结，不超过200字。";

async function describeWithOpenAI(
  settings: LLMSettings,
  mimeType: string,
  base64Data: string,
): Promise<string> {
  const baseUrl = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = settings.model || "gpt-4o-mini";

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 500,
    }),
  });

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "无法描述图片";
}

async function describeWithClaude(
  settings: LLMSettings,
  mimeType: string,
  base64Data: string,
): Promise<string> {
  const baseUrl = (settings.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = settings.model || "claude-sonnet-4-20250514";

  // Claude uses media_type format like "image/jpeg"
  const mediaType = mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    }),
  });

  const data = (await resp.json()) as { content?: { text?: string }[]; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "无法描述图片";
}

async function describeWithGemini(
  settings: LLMSettings,
  mimeType: string,
  base64Data: string,
): Promise<string> {
  const model = settings.model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: VISION_PROMPT },
          ],
        },
      ],
    }),
  });

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "无法描述图片";
}
