import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingStore } from "../stores/settingStore";
import { Save, Eye, EyeOff, Zap, Loader2, CheckCircle, XCircle, ChevronDown } from "lucide-react";

const LLM_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini" },
  { value: "claude", label: "Claude", defaultModel: "claude-sonnet-4-20250514" },
  { value: "gemini", label: "Gemini", defaultModel: "gemini-2.0-flash" },
];

export default function SettingsPage() {
  const { settings, fetchSettings, setSetting, deleteSetting } = useSettingStore();
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Local form state
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Embedding config
  const [embBaseUrl, setEmbBaseUrl] = useState("");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embModel, setEmbModel] = useState("");
  const [embDimensions, setEmbDimensions] = useState("");
  const [showEmbKey, setShowEmbKey] = useState(false);

  // LLM model list state
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Embedding model list state
  const [availableEmbModels, setAvailableEmbModels] = useState<string[]>([]);
  const [loadingEmbModels, setLoadingEmbModels] = useState(false);
  const [showEmbModelDropdown, setShowEmbModelDropdown] = useState(false);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setProvider(settings["llm_provider"] || "openai");
    setApiKey(settings["llm_api_key"] || "");
    setModel(settings["llm_model"] || "");
    setBaseUrl(settings["llm_base_url"] || "");
    setEmbBaseUrl(settings["embedding_base_url"] || "");
    setEmbApiKey(settings["embedding_api_key"] || "");
    setEmbModel(settings["embedding_model"] || "");
    setEmbDimensions(settings["embedding_dimensions"] || "1536");
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setSetting("llm_provider", provider);
      await setSetting("llm_api_key", apiKey);
      await setSetting("llm_model", model || LLM_PROVIDERS.find((p) => p.value === provider)?.defaultModel || "");
      if (baseUrl) {
        await setSetting("llm_base_url", baseUrl);
      } else {
        await deleteSetting("llm_base_url");
      }
      if (embBaseUrl) await setSetting("embedding_base_url", embBaseUrl);
      else await deleteSetting("embedding_base_url");
      if (embApiKey) await setSetting("embedding_api_key", embApiKey);
      else await deleteSetting("embedding_api_key");
      if (embModel) await setSetting("embedding_model", embModel);
      else await deleteSetting("embedding_model");
      await setSetting("embedding_dimensions", embDimensions || "1536");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save settings first so the backend reads the latest values
      await handleSave();
      const response = await invoke<string>("test_llm_connection");
      setTestResult({ ok: true, message: response });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    try {
      await handleSave();
      const models = await invoke<string[]>("list_models");
      setAvailableModels(models);
      setShowModelDropdown(true);
    } catch (e) {
      setTestResult({ ok: false, message: `Failed to fetch models: ${e}` });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleFetchEmbModels = async () => {
    setLoadingEmbModels(true);
    try {
      await handleSave();
      const models = await invoke<string[]>("list_embedding_models");
      setAvailableEmbModels(models);
      setShowEmbModelDropdown(true);
    } catch (e) {
      setTestResult({ ok: false, message: `Failed to fetch embedding models: ${e}` });
    } finally {
      setLoadingEmbModels(false);
    }
  };

  const inputClass =
    "w-full bg-white/50 backdrop-blur-sm border border-white/60 rounded-xl px-4 py-3 text-[#31323b] placeholder-[#a1a1aa] focus:outline-none focus:border-[#575b8c] focus:ring-2 focus:ring-[#575b8c]/20 transition-all text-sm";
  const labelClass = "block text-xs font-semibold text-[#575b8c] uppercase tracking-wider mb-2";

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div className="flex justify-center w-full">
        <div className="w-full max-w-3xl">
          <div className="space-y-8 py-8">
            <div className="pt-4">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#575b8c] to-[#8a8dc4] font-[Manrope] tracking-tight">
                设置
              </h1>
              <p className="text-[#7a7a84] mt-2 font-medium">
                配置 AI 模型提供商和 API 密钥
              </p>
            </div>

            {/* LLM Config */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-6">
              <h2 className="text-lg font-bold text-[#3a3e6c]">LLM 模型配置</h2>

              <div>
                <label className={labelClass}>提供商</label>
                <div className="flex gap-2">
                  {LLM_PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => {
                        setProvider(p.value);
                        setModel(p.defaultModel);
                        setBaseUrl("");
                        setShowModelDropdown(false);
                        setAvailableModels([]);
                      }}
                      className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                        provider === p.value
                          ? "bg-[#575b8c] text-white shadow-lg shadow-[#575b8c]/25"
                          : "bg-white/60 text-[#5e5e68] hover:bg-white hover:shadow-sm border border-white/60"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={inputClass}
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1a1aa] hover:text-[#575b8c] transition-colors p-1"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="relative">
                <label className={labelClass}>模型名称</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o-mini"
                    className={inputClass}
                  />
                  <button
                    onClick={handleFetchModels}
                    disabled={loadingModels || !apiKey}
                    className="shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-xl bg-white/60 text-[#575b8c] hover:bg-white hover:shadow-sm disabled:opacity-50 transition-all border border-white/60"
                    title="获取可用模型"
                  >
                    {loadingModels ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">Models</span>
                  </button>
                </div>
                {showModelDropdown && availableModels.length > 0 && (
                  <div className="absolute z-10 mt-2 w-full bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                    {availableModels.map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setModel(m);
                          setShowModelDropdown(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm hover:bg-[#f4f0fa] transition-colors first:rounded-t-2xl last:rounded-b-2xl ${
                          m === model ? "bg-[#f4f0fa] text-[#575b8c] font-medium" : "text-[#31323b]"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className={labelClass}>Base URL (可选，用于自定义端点)</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className={inputClass}
                />
              </div>

              {/* Test Connection */}
              <div className="pt-4 border-t border-[#e3e1ed]/50">
                <button
                  onClick={handleTest}
                  disabled={testing || !apiKey}
                  className="flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-xl bg-white/60 text-[#575b8c] hover:bg-white hover:shadow-sm disabled:opacity-50 transition-all border border-white/60"
                >
                  {testing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  {testing ? "测试中..." : "测试连接"}
                </button>

                {testResult && (
                  <div
                    className={`mt-4 flex items-start gap-3 text-sm rounded-2xl px-4 py-3 ${
                      testResult.ok
                        ? "bg-emerald-50/80 text-emerald-700 border border-emerald-200/50"
                        : "bg-[#f97386]/10 text-[#a8364b] border border-[#f97386]/20"
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    )}
                    <span className="break-all">{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Embedding Config */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-[#3a3e6c]">Embedding 模型配置</h2>
                <p className="text-xs text-[#7a7a84] mt-2">用于语义搜索和相关灵感发现。留空 API Key 则自动使用上方 LLM 配置。</p>
              </div>

              {/* Auto hint */}
              {!embApiKey && (
                <div className="flex items-center gap-3 text-sm text-[#575b8c] bg-gradient-to-r from-[#f4f0fa] to-white/50 rounded-2xl px-4 py-3 border border-[#e3e1ed]/50">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>
                    自动使用 {provider === "gemini" ? "Gemini (gemini-embedding-exp-03-07)" : provider === "openai" ? "OpenAI (text-embedding-3-small)" : "LLM"} API Key
                  </span>
                </div>
              )}

              <div>
                <label className={labelClass}>API Key（可选，留空自动使用上方 Key）</label>
                <div className="relative">
                  <input
                    type={showEmbKey ? "text" : "password"}
                    value={embApiKey}
                    onChange={(e) => setEmbApiKey(e.target.value)}
                    placeholder="留空则与 LLM 共用 API Key"
                    className={inputClass}
                  />
                  <button
                    onClick={() => setShowEmbKey(!showEmbKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1a1aa] hover:text-[#575b8c] transition-colors p-1"
                  >
                    {showEmbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <label className={labelClass}>Model Name（可选）</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={embModel}
                      onChange={(e) => setEmbModel(e.target.value)}
                      placeholder={provider === "gemini" ? "gemini-embedding-exp-03-07" : "text-embedding-3-small"}
                      className={inputClass}
                    />
                    <button
                      onClick={handleFetchEmbModels}
                      disabled={loadingEmbModels || !apiKey}
                      className="shrink-0 flex items-center gap-1 px-3 py-3 text-sm font-medium rounded-xl bg-white/60 text-[#575b8c] hover:bg-white hover:shadow-sm disabled:opacity-50 transition-all border border-white/60"
                      title="获取可用模型"
                    >
                      {loadingEmbModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                  {showEmbModelDropdown && availableEmbModels.length > 0 && (
                    <div className="absolute z-10 mt-2 w-full bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl max-h-48 overflow-y-auto">
                      {availableEmbModels.map((m) => (
                        <button
                          key={m}
                          onClick={() => { setEmbModel(m); setShowEmbModelDropdown(false); }}
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-[#f4f0fa] transition-colors ${m === embModel ? "bg-[#f4f0fa] text-[#575b8c] font-medium" : "text-[#31323b]"}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Dimensions</label>
                  <input
                    type="number"
                    value={embDimensions}
                    onChange={(e) => setEmbDimensions(e.target.value)}
                    placeholder="1536"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>API Base URL（可选，自定义端点）</label>
                <input
                  type="text"
                  value={embBaseUrl}
                  onChange={(e) => setEmbBaseUrl(e.target.value)}
                  placeholder={provider === "gemini" ? "自动使用 Gemini 端点" : "https://api.openai.com/v1/embeddings"}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-[#575b8c] hover:bg-[#434670] text-white py-4 rounded-2xl font-medium shadow-lg shadow-[#575b8c]/25 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              <Save className="w-5 h-5" />
              {saved ? "已保存！" : saving ? "保存中..." : "保存设置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
