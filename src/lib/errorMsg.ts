/**
 * 把后端 / 网络 / LLM 抛出的英文错误翻译成对用户友好的中文。
 *
 * 后端错误典型形态（参考 src-tauri/echomind-core/src/llm/*.rs）：
 *   "Gemini API error (401): {\"error\":{\"message\":\"...\"}}"
 *   "OpenAI request failed: error sending request for url"
 *   "reqwest::Error { kind: ... }"
 *
 * 识别失败时退化为「去前缀 + 单行 + 截断」的纯净版本，至少不会弹一堆 stack。
 */
export function errorMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  const statusMatch = raw.match(/\((\d{3})\)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : null;

  // ── 鉴权 ────────────────────────────────────────────────────
  if (status === 401 || /invalid[_\s]api[_\s]?key|unauthorized|invalid authentication|incorrect api key/i.test(raw)) {
    return "API Key 无效或未授权——请到「设置 → LLM 配置」检查 Key 是否正确。";
  }
  if (status === 403 || /\bforbidden\b/i.test(raw)) {
    return "没有访问权限——此模型可能未对你的账号开放。";
  }

  // ── 额度 / 速率 ─────────────────────────────────────────────
  if (status === 429 || /rate[_\s]?limit|too many requests/i.test(raw)) {
    return "调用过于频繁，请稍等再试。";
  }
  if (/insufficient[_\s]?(quota|balance)|exceeded your.*quota|billing|payment|credit|out of credit|余额不足/i.test(raw)) {
    return "API 额度已用完——请到 LLM 提供商账户充值后再试。";
  }

  // ── 模型 ────────────────────────────────────────────────────
  if (/model[_\s]?not[_\s]?found|does not exist|invalid model|the model `[^`]+`/i.test(raw)) {
    return "选定的模型不存在或不可用——请到「设置 → LLM 配置」改用其他模型。";
  }
  if (/context[_\s]?length|maximum context|too many tokens|input is too long/i.test(raw)) {
    return "对话上下文过长——请减少历史消息或精简内容后再发。";
  }

  // ── 网络 ────────────────────────────────────────────────────
  if (
    /\b(connection refused|connection reset|dns|timed?\s*out|unreachable)\b/i.test(raw) ||
    /(request failed|fetch failed|networkerror|error sending request)/i.test(raw)
  ) {
    return "网络连接失败——请检查网络或代理设置。";
  }

  // ── Bridge / JWT ────────────────────────────────────────────
  if (/jwt|token.*invalid|expired/i.test(lower) && /bridge|pair|device/i.test(lower)) {
    return "Cloud Bridge 凭证失效，请到「云桥」页面重新配对。";
  }
  if (/pair[_\s]?code.*(invalid|expired|not found)/i.test(raw)) {
    return "配对码无效或已过期，请重新申请。";
  }

  // ── 服务端 ──────────────────────────────────────────────────
  if (status && status >= 500) {
    return "LLM 服务暂时不可用，请稍后重试。";
  }

  // ── 文件 / 数据库 ──────────────────────────────────────────
  if (/no such file|file not found/i.test(raw)) {
    return "找不到文件——可能已被移动或删除。";
  }
  if (/database is locked|sqlite/i.test(lower)) {
    return "本地数据库忙，请稍候再试。";
  }

  // ── 兜底：清理一下噪音再返回 ────────────────────────────────
  return raw
    .replace(/^Error:\s*/i, "")
    .replace(/^reqwest::Error\b.*?:\s*/, "")
    .replace(/^[A-Za-z]+ (request failed|API error \(\d+\)):\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
