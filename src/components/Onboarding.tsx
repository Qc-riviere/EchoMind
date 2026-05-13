import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useSettingStore } from "../stores/settingStore";

const LLM_PROVIDERS = [
  {
    value: "openai",
    label: "OpenAI",
    backend: "openai",
    defaultModel: "gpt-4o-mini",
    baseUrl: "",
    apiUrl: "https://platform.openai.com/api-keys",
    hint: "国际版，需海外支付方式。模型最全。",
  },
  {
    value: "claude",
    label: "Claude",
    backend: "claude",
    defaultModel: "claude-sonnet-4-20250514",
    baseUrl: "",
    apiUrl: "https://console.anthropic.com/settings/keys",
    hint: "Anthropic 官方，深度对话最强，需海外支付。",
  },
  {
    value: "gemini",
    label: "Gemini",
    backend: "gemini",
    defaultModel: "gemini-2.0-flash",
    baseUrl: "",
    apiUrl: "https://aistudio.google.com/apikey",
    hint: "Google 免费额度宽松，适合上手测试。",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    backend: "openai",
    defaultModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
    apiUrl: "https://platform.deepseek.com/api_keys",
    hint: "国内充值方便，¥10 即可起步，推荐新手。",
  },
];

type Props = { onClose: () => void };

export default function Onboarding({ onClose }: Props) {
  const { setSetting } = useSettingStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [firstNote, setFirstNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const def = LLM_PROVIDERS.find((p) => p.value === provider)!;

  const saveLlm = async () => {
    await setSetting("llm_provider", def.backend);
    await setSetting("llm_provider_preset", provider);
    await setSetting("llm_api_key", apiKey);
    await setSetting("llm_model", def.defaultModel);
    if (def.baseUrl) await setSetting("llm_base_url", def.baseUrl);
    await setSetting(`llm_api_key__${provider}`, apiKey);
    await setSetting(`llm_model__${provider}`, def.defaultModel);
    if (def.baseUrl) await setSetting(`llm_base_url__${provider}`, def.baseUrl);
  };

  const handleSaveAndTest = async () => {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, message: "请先填入 API Key" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      await saveLlm();
      const response = await invoke<string>("test_llm_connection");
      setTestResult({ ok: true, message: response || "连接成功" });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveFirstNote = async () => {
    if (!firstNote.trim()) {
      setStep(4);
      return;
    }
    setSavingNote(true);
    try {
      await invoke("create_thought", { content: firstNote.trim() });
    } catch {
      /* swallow — user can retry from home */
    } finally {
      setSavingNote(false);
      setStep(4);
    }
  };

  const complete = async () => {
    await setSetting("onboarding_completed", "1");
    onClose();
  };

  const skip = async () => {
    await setSetting("onboarding_dismissed", "1");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-surface/80 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-surface-container rounded-3xl shadow-2xl border border-outline-variant/30 flex flex-col max-h-[90vh]">
        {/* Progress bar */}
        <div className="flex items-center gap-2 px-10 pt-8">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                n <= step ? "bg-primary" : "bg-surface-container-highest"
              }`}
            />
          ))}
        </div>
        <div className="px-10 pt-2 pb-1 text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60 font-mono">
          Step {step} / 4
        </div>

        <div className="px-10 pb-10 pt-4 overflow-y-auto">
          {step === 1 && (
            <>
              <h1 className="text-3xl font-headline font-semibold text-on-surface mb-3">
                欢迎使用 EchoMind
              </h1>
              <p className="text-sm text-on-surface-variant/80 mb-6 leading-relaxed">
                一款本地优先 + 微信原生的灵感备忘录。三句话讲清能做什么：
              </p>
              <ul className="space-y-3 mb-8 text-sm text-on-surface leading-relaxed">
                <li className="flex gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px]">bolt</span>
                  <span><b>零摩擦速记</b> — 按 <kbd className="px-1.5 py-0.5 rounded bg-surface-container-highest text-xs font-mono">Ctrl+Shift+I</kbd> 任意场景唤出浮窗，Enter 即落库。手机微信发条消息也能记。</span>
                </li>
                <li className="flex gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px]">auto_awesome</span>
                  <span><b>AI 二次加工</b> — 自动补全上下文/标签；多选灵感一键归纳为结构化总结并导出 MD/DOCX/PDF。</span>
                </li>
                <li className="flex gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px]">lock</span>
                  <span><b>本地优先 + 自带 Key</b> — 默认所有数据存本地；LLM 调用使用你自己的 API Key，不经任何第三方。</span>
                </li>
              </ul>
              <div className="flex justify-between items-center">
                <button
                  onClick={skip}
                  className="text-sm text-on-surface-variant/70 hover:text-on-surface transition-colors"
                >
                  稍后再设置
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-3 bg-primary text-on-primary rounded-full font-semibold hover:opacity-90 transition-opacity"
                >
                  开始（30 秒）
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-headline font-semibold text-on-surface mb-3">
                配置 LLM
              </h1>
              <p className="text-sm text-on-surface-variant/80 mb-6 leading-relaxed">
                EchoMind 用 LLM 做自动补全和对话深挖。选一个 Provider 并填 Key（不会上传到任何第三方服务器）。
              </p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                {LLM_PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`text-left rounded-2xl p-4 border-2 transition-all ${
                      provider === p.value
                        ? "border-primary bg-surface-container-high"
                        : "border-outline-variant/30 bg-surface-container-low hover:border-outline-variant/60"
                    }`}
                  >
                    <div className="font-semibold text-on-surface text-sm mb-1">{p.label}</div>
                    <div className="text-[11px] text-on-surface-variant/70 leading-snug">{p.hint}</div>
                  </button>
                ))}
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-on-surface-variant uppercase tracking-wider">API Key</label>
                  <a
                    href={def.apiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    获取 {def.label} Key
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={def.value === "openai" ? "sk-..." : def.value === "deepseek" ? "sk-..." : "..."}
                    className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-3 pr-12 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showKey ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
                <div className="text-[11px] text-on-surface-variant/60 mt-1.5">
                  模型默认使用 <code className="font-mono">{def.defaultModel}</code>，可在设置页再调。
                </div>
              </div>

              {testResult && (
                <div
                  className={`rounded-xl px-4 py-2.5 mb-4 text-[12px] flex items-start gap-2 ${
                    testResult.ok
                      ? "bg-tertiary-container/30 text-tertiary"
                      : "bg-error-container/20 text-error"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] flex-shrink-0">
                    {testResult.ok ? "check_circle" : "error"}
                  </span>
                  <span className="break-all">{testResult.message}</span>
                </div>
              )}

              <div className="flex justify-between items-center mt-6">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-on-surface-variant/70 hover:text-on-surface transition-colors"
                >
                  ← 上一步
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveAndTest}
                    disabled={testing}
                    className="px-4 py-2.5 rounded-full border border-outline-variant/40 text-sm hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {testing && (
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    )}
                    {testing ? "测试中..." : "保存并测试"}
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={!testResult?.ok}
                    className="px-6 py-2.5 bg-primary text-on-primary rounded-full font-semibold hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    下一步
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-headline font-semibold text-on-surface mb-3">
                录第一条灵感
              </h1>
              <p className="text-sm text-on-surface-variant/80 mb-6 leading-relaxed">
                随便写点什么——一个想法、一个待办、一句话感悟。落库后 AI 会自动补全标签和上下文。
              </p>
              <textarea
                value={firstNote}
                onChange={(e) => setFirstNote(e.target.value)}
                rows={5}
                placeholder="例如：今天想到一个产品点子，把灵感记录和微信打通，让任何想法在 30 秒内入库……"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary resize-none"
              />
              <div className="flex justify-between items-center mt-6">
                <button
                  onClick={() => setStep(2)}
                  className="text-sm text-on-surface-variant/70 hover:text-on-surface transition-colors"
                >
                  ← 上一步
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(4)}
                    className="px-4 py-2.5 rounded-full text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
                  >
                    跳过
                  </button>
                  <button
                    onClick={handleSaveFirstNote}
                    disabled={savingNote}
                    className="px-6 py-2.5 bg-primary text-on-primary rounded-full font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {savingNote && (
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    )}
                    {savingNote ? "保存中..." : "保存并继续"}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-2xl font-headline font-semibold text-on-surface mb-3">
                想让微信也能记？
              </h1>
              <p className="text-sm text-on-surface-variant/80 mb-6 leading-relaxed">
                EchoMind 接入了腾讯 2026 官方放开的微信 ClawBot——手机微信发条消息即落库，桌面端 30 秒内同步并弹通知。
                <br />
                <span className="text-on-surface-variant/60">扫码即用，无封号风险。也可以稍后从侧边栏「微信桥」进入。</span>
              </p>
              <div className="rounded-2xl bg-surface-container-low border border-outline-variant/20 p-5 mb-6">
                <div className="text-xs text-on-surface-variant uppercase tracking-wider mb-2">如何启用</div>
                <ol className="space-y-2 text-sm text-on-surface leading-relaxed list-decimal pl-5">
                  <li>侧边栏点击「微信桥」</li>
                  <li>点击「启动微信桥」，等待 daemon 调起腾讯官方 CLI</li>
                  <li>用你的微信扫弹出的二维码授权</li>
                  <li>手机微信发文字 / 命令 (<code className="font-mono text-[12px]">/list</code>, <code className="font-mono text-[12px]">/chat &lt;ID&gt;</code>) 即可远程操作</li>
                </ol>
              </div>

              <div className="flex justify-between items-center mt-6">
                <button
                  onClick={() => setStep(3)}
                  className="text-sm text-on-surface-variant/70 hover:text-on-surface transition-colors"
                >
                  ← 上一步
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={complete}
                    className="px-4 py-2.5 rounded-full text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
                  >
                    稍后再说
                  </button>
                  <button
                    onClick={async () => {
                      await complete();
                      navigate("/wechat");
                    }}
                    className="px-6 py-2.5 bg-primary text-on-primary rounded-full font-semibold hover:opacity-90 transition-opacity"
                  >
                    去配置微信桥
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
