import crypto from "node:crypto";
import { ImageItem, CDNMedia } from "./types.js";

const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const CDN_TIMEOUT = 30_000;

/**
 * Extract CDN info from an image item (handles multiple formats).
 */
function extractCdnInfo(img: ImageItem): { encryptQueryParam: string; aesKey: string } | null {
  if (img.cdn_media) {
    return {
      encryptQueryParam: img.cdn_media.encrypt_query_param,
      aesKey: img.cdn_media.aes_key,
    };
  }
  if (img.media) {
    return {
      encryptQueryParam: img.media.encrypt_query_param,
      aesKey: img.media.aes_key,
    };
  }
  return null;
}

/**
 * Parse AES key from base64 — handles both raw-16-byte and hex-string formats.
 */
function parseAesKey(keyB64: string): Buffer {
  const buf = Buffer.from(keyB64, "base64");

  if (buf.length === 16) {
    // Raw 16 bytes
    return buf;
  }

  // base64 of hex string (32 hex chars → 16 bytes)
  const hex = buf.toString("utf8");
  if (/^[0-9a-fA-F]{32}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }

  // Fallback: truncate or pad
  if (buf.length > 16) return buf.subarray(0, 16);
  const padded = Buffer.alloc(16);
  buf.copy(padded);
  return padded;
}

/**
 * Decrypt AES-128-ECB.
 */
function decryptAesEcb(key: Buffer, data: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Detect MIME type from magic bytes.
 */
function detectMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return "image/jpeg";
}

/**
 * Download and decrypt an image from WeChat CDN.
 * Returns a data URI (data:image/xxx;base64,...).
 */
export async function downloadImage(img: ImageItem): Promise<string | null> {
  const cdn = extractCdnInfo(img);
  if (!cdn) {
    // Try direct URL
    if (img.url) return img.url;
    return null;
  }

  const url = `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(cdn.encryptQueryParam)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CDN_TIMEOUT);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      console.error(`[media] CDN download failed: ${resp.status}`);
      return null;
    }

    const encrypted = Buffer.from(await resp.arrayBuffer());
    const key = parseAesKey(cdn.aesKey);
    const decrypted = decryptAesEcb(key, encrypted);
    const mime = detectMime(decrypted);

    return `data:${mime};base64,${decrypted.toString("base64")}`;
  } catch (e) {
    console.error("[media] Download error:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
