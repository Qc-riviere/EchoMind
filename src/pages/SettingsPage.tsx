import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingStore } from "../stores/settingStore";
import { useThemeStore } from "../stores/themeStore";
import type { Skill, DiscoveredSkill } from "../lib/types";

const LLM_PROVIDERS = [
  { value: "openai", label: "OpenAI", backend: "openai", defaultModel: "gpt-4o-mini", defaultBaseUrl: "" },
  { value: "claude", label: "Claude", backend: "claude", defaultModel: "claude-sonnet-4-20250514", defaultBaseUrl: "" },
  { value: "gemini", label: "Gemini", backend: "gemini", defaultModel: "gemini-2.0-flash", defaultBaseUrl: "" },
  { value: "deepseek", label: "DeepSeek", backend: "openai", defaultModel: "deepseek-chat", defaultBaseUrl: "https://api.deepseek.com/v1" },
];

type SettingsTab = "llm" | "embedding" | "ai" | "skills" | "appearance" | "data" | "about";

const NAV_ITEMS: { key: SettingsTab; icon: string; label: string }[] = [
  { key: "llm", icon: "auto_awesome", label: "LLM Config" },
  { key: "embedding", icon: "hub", label: "Embedding" },
  { key: "ai", icon: "psychology", label: "AI Behavior" },
  { key: "skills", icon: "bolt", label: "Skills" },
  { key: "appearance", icon: "palette", label: "Appearance" },
  { key: "data", icon: "database", label: "Data" },
  { key: "about", icon: "info", label: "About" },
];

export default function SettingsPage() {
  const { settings, fetchSettings, setSetting, deleteSetting } = useSettingStore();
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("llm");

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const [embBaseUrl, setEmbBaseUrl] = useState("");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embModel, setEmbModel] = useState("");
  const [embDimensions, setEmbDimensions] = useState("");
  const [showEmbKey, setShowEmbKey] = useState(false);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const [availableEmbModels, setAvailableEmbModels] = useState<string[]>([]);
  const [loadingEmbModels, setLoadingEmbModels] = useState(false);
  const [showEmbModelDropdown, setShowEmbModelDropdown] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Drafts kept in memory per provider so switching tabs doesn't lose unsaved
  // edits. Backed by a ref so writes don't re-render mid-typing.
  const draftsRef = useRef<Record<string, { apiKey: string; model: string; baseUrl: string }>>({});
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    if (Object.keys(settings).length === 0) return;
    initializedRef.current = true;
    // Seed per-provider drafts from saved settings.
    for (const p of LLM_PROVIDERS) {
      draftsRef.current[p.value] = {
        apiKey: settings[`llm_api_key__${p.value}`] ?? "",
        model: settings[`llm_model__${p.value}`] ?? p.defaultModel,
        baseUrl: settings[`llm_base_url__${p.value}`] ?? p.defaultBaseUrl,
      };
    }
    const preset = settings["llm_provider_preset"] || settings["llm_provider"] || "openai";
    // For the active preset, fall back to legacy single-key settings if no per-provider stash exists yet.
    const activeDraft = draftsRef.current[preset] ?? { apiKey: "", model: "", baseUrl: "" };
    if (!settings[`llm_api_key__${preset}`] && settings["llm_api_key"]) {
      activeDraft.apiKey = settings["llm_api_key"];
    }
    if (!settings[`llm_model__${preset}`] && settings["llm_model"]) {
      activeDraft.model = settings["llm_model"];
    }
    if (!settings[`llm_base_url__${preset}`] && settings["llm_base_url"]) {
      activeDraft.baseUrl = settings["llm_base_url"];
    }
    draftsRef.current[preset] = activeDraft;

    setProvider(preset);
    setApiKey(activeDraft.apiKey);
    setModel(activeDraft.model);
    setBaseUrl(activeDraft.baseUrl);

    setEmbBaseUrl(settings["embedding_base_url"] || "");
    setEmbApiKey(settings["embedding_api_key"] || "");
    setEmbModel(settings["embedding_model"] || "");
    setEmbDimensions(settings["embedding_dimensions"] || "1536");
  }, [settings]);

  // Mirror current form fields into the active provider's draft on every change.
  useEffect(() => {
    if (!provider || !initializedRef.current) return;
    draftsRef.current[provider] = { apiKey, model, baseUrl };
  }, [provider, apiKey, model, baseUrl]);

  const switchProvider = (next: string) => {
    if (next === provider) return;
    const next_def = LLM_PROVIDERS.find((p) => p.value === next);
    const draft = draftsRef.current[next] ?? {
      apiKey: "",
      model: next_def?.defaultModel ?? "",
      baseUrl: next_def?.defaultBaseUrl ?? "",
    };
    setProvider(next);
    setApiKey(draft.apiKey);
    setModel(draft.model);
    setBaseUrl(draft.baseUrl);
    setShowModelDropdown(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const def = LLM_PROVIDERS.find((p) => p.value === provider);
      const backend = def?.backend ?? provider;
      const finalModel = model || def?.defaultModel || "";
      const finalBaseUrl = baseUrl || def?.defaultBaseUrl || "";
      // Active keys (read by backend).
      await setSetting("llm_provider", backend);
      await setSetting("llm_provider_preset", provider);
      await setSetting("llm_api_key", apiKey);
      await setSetting("llm_model", finalModel);
      if (finalBaseUrl) await setSetting("llm_base_url", finalBaseUrl);
      else await deleteSetting("llm_base_url");
      // Per-provider stash (preserved across provider switches).
      await setSetting(`llm_api_key__${provider}`, apiKey);
      await setSetting(`llm_model__${provider}`, finalModel);
      if (finalBaseUrl) await setSetting(`llm_base_url__${provider}`, finalBaseUrl);
      else await deleteSetting(`llm_base_url__${provider}`);

      if (embBaseUrl) await setSetting("embedding_base_url", embBaseUrl); else await deleteSetting("embedding_base_url");
      if (embApiKey) await setSetting("embedding_api_key", embApiKey); else await deleteSetting("embedding_api_key");
      if (embModel) await setSetting("embedding_model", embModel); else await deleteSetting("embedding_model");
      await setSetting("embedding_dimensions", embDimensions || "1536");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await handleSave();
      const response = await invoke<string>("test_llm_connection");
      setTestResult({ ok: true, message: response });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally { setTesting(false); }
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
    } finally { setLoadingModels(false); }
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
    } finally { setLoadingEmbModels(false); }
  };

  const inputClass = "w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-primary text-sm";
  const labelClass = "text-[10px] font-bold text-on-surface-variant uppercase tracking-widest";

  return (
    <div className="max-w-5xl mx-auto px-8 py-12 w-full">
      {/* Header */}
      <div className="mb-12 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-[24px] text-primary">settings</span>
        </div>
        <div>
          <h1 className="text-3xl font-headline font-bold text-on-surface">Preferences</h1>
          <p className="text-sm text-on-surface-variant mt-1">Configure your cognitive environment.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
        {/* Left nav */}
        <div className="md:col-span-3">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm ${
                  activeTab === item.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="md:col-span-9 space-y-10">
          {/* LLM Config */}
          {activeTab === "llm" && (
            <>
              <section>
                <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">LLM Provider</h3>
                <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-6">
                  {/* Provider */}
                  <div className="space-y-2">
                    <label className={labelClass}>Provider</label>
                    <div className="flex gap-2">
                      {LLM_PROVIDERS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => switchProvider(p.value)}
                          className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                            provider === p.value
                              ? "bg-primary text-on-primary"
                              : "bg-surface-container-highest text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-px w-full bg-outline-variant/10" />

                  {/* API Key */}
                  <div className="space-y-2">
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
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">{showKey ? "visibility_off" : "visibility"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Model */}
                  <div className="space-y-2 relative">
                    <label className={labelClass}>Model</label>
                    <div className="flex gap-2">
                      <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o-mini" className={inputClass} />
                      <button
                        onClick={handleFetchModels}
                        disabled={loadingModels || !apiKey}
                        className="shrink-0 px-3 py-3 bg-surface-container-highest text-on-surface-variant hover:text-primary rounded-xl transition-colors disabled:opacity-50"
                      >
                        {loadingModels ? (
                          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined text-[18px]">expand_more</span>
                        )}
                      </button>
                    </div>
                    {showModelDropdown && availableModels.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-surface-container-high rounded-xl ghost-border max-h-60 overflow-y-auto shadow-xl">
                        {availableModels.map((m) => (
                          <button
                            key={m}
                            onClick={() => { setModel(m); setShowModelDropdown(false); }}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-surface-container-highest transition-colors flex items-center justify-between ${
                              m === model ? "text-primary font-medium" : "text-on-surface"
                            }`}
                          >
                            {m}
                            {m === model && <span className="material-symbols-outlined text-[16px] text-primary">check</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Base URL */}
                  <div className="space-y-2">
                    <label className={labelClass}>Base URL (Optional)</label>
                    <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className={inputClass} />
                  </div>
                </div>
              </section>

              {/* Test Connection */}
              <section>
                <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">Connection Test</h3>
                <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-on-surface text-sm">Verify LLM Connection</h4>
                      <p className="text-xs text-on-surface-variant mt-1">Save and test your current configuration.</p>
                    </div>
                    <button
                      onClick={handleTest}
                      disabled={testing || !apiKey}
                      className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                    >
                      {testing ? (
                        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-[18px]">bolt</span>
                      )}
                      {testing ? "Testing..." : "Test"}
                    </button>
                  </div>
                  {testResult && (
                    <div className={`flex items-start gap-3 text-sm rounded-xl px-4 py-3 ${
                      testResult.ok ? "bg-primary/10 text-primary" : "bg-error-container/20 text-error"
                    }`}>
                      <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                        {testResult.ok ? "check_circle" : "error"}
                      </span>
                      <span className="break-all">{testResult.message}</span>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Embedding Config */}
          {activeTab === "embedding" && (
            <section>
              <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">Embedding Configuration</h3>
              <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-6">
                {/* Hint */}
                {!embApiKey && (
                  <div className="flex items-center gap-3 text-sm text-primary bg-primary/5 rounded-xl px-4 py-3">
                    <span className="material-symbols-outlined text-[18px]">lock</span>
                    <span>Reuse LLM Key — Inherit authentication from the primary provider.</span>
                  </div>
                )}

                {/* Independent API Key */}
                <div className="space-y-2">
                  <label className={labelClass}>Independent API Key (Optional)</label>
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">{showEmbKey ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                </div>

                <div className="h-px w-full bg-outline-variant/10" />

                {/* Model + Dimensions */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2 relative">
                    <label className={labelClass}>Model Name</label>
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
                        className="shrink-0 px-3 py-3 bg-surface-container-highest text-on-surface-variant hover:text-primary rounded-xl transition-colors disabled:opacity-50"
                      >
                        {loadingEmbModels ? (
                          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined text-[18px]">expand_more</span>
                        )}
                      </button>
                    </div>
                    {showEmbModelDropdown && availableEmbModels.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-surface-container-high rounded-xl ghost-border max-h-48 overflow-y-auto shadow-xl">
                        {availableEmbModels.map((m) => (
                          <button
                            key={m}
                            onClick={() => { setEmbModel(m); setShowEmbModelDropdown(false); }}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-surface-container-highest transition-colors ${
                              m === embModel ? "text-primary font-medium" : "text-on-surface"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className={labelClass}>Dimensions</label>
                    <input type="number" value={embDimensions} onChange={(e) => setEmbDimensions(e.target.value)} placeholder="1536" className={inputClass} />
                  </div>
                </div>

                {/* Base URL */}
                <div className="space-y-2">
                  <label className={labelClass}>API Base URL (Optional)</label>
                  <input
                    type="text"
                    value={embBaseUrl}
                    onChange={(e) => setEmbBaseUrl(e.target.value)}
                    placeholder={provider === "gemini" ? "自动使用 Gemini 端点" : "https://api.openai.com/v1/embeddings"}
                    className={inputClass}
                  />
                </div>
              </div>
            </section>
          )}

          {/* AI Behavior */}
          {activeTab === "ai" && (
            <section>
              <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">AI Behavior</h3>
              <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-6">
                <ToggleRow
                  title="Auto-Tagging"
                  desc="Allow AI to automatically categorize new entries."
                  defaultOn
                />
                <div className="h-px w-full bg-outline-variant/10" />
                <ToggleRow
                  title="Semantic Linking"
                  desc="Suggest connections between disparate thoughts."
                  defaultOn
                />
                <div className="h-px w-full bg-outline-variant/10" />
                <ToggleRow
                  title="Auto-Enrich on Save"
                  desc="Automatically generate AI context when saving a new thought."
                  defaultOn
                />
                <div className="h-px w-full bg-outline-variant/10" />
                <div className="space-y-3">
                  <label className={labelClass}>Model Creativity (Temperature)</label>
                  <input type="range" min="0" max="100" defaultValue="70" className="w-full accent-primary" />
                  <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                    <span>Analytical</span>
                    <span>Balanced</span>
                    <span>Creative</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Skills */}
          {activeTab === "skills" && (
            <SkillsTab inputClass={inputClass} labelClass={labelClass} />
          )}

          {/* Appearance */}
          {activeTab === "appearance" && (
            <AppearanceTab labelClass={labelClass} />
          )}

          {/* Data Management */}
          {activeTab === "data" && (
            <section>
              <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">Data Management</h3>
              <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-on-surface text-sm">Export All Data</h4>
                    <p className="text-xs text-on-surface-variant mt-1">Download all thoughts, conversations, and settings as JSON.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Export
                  </button>
                </div>
                <div className="h-px w-full bg-outline-variant/10" />
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-on-surface text-sm">Import Data</h4>
                    <p className="text-xs text-on-surface-variant mt-1">Restore from a previous export file.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all">
                    <span className="material-symbols-outlined text-[18px]">upload</span>
                    Import
                  </button>
                </div>
                <div className="h-px w-full bg-outline-variant/10" />
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-on-surface text-sm">Rebuild Vector Index</h4>
                    <p className="text-xs text-on-surface-variant mt-1">Re-embed all thoughts for semantic search. May take a while.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all">
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    Rebuild
                  </button>
                </div>
                <div className="h-px w-full bg-outline-variant/10" />
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-error text-sm">Clear All Data</h4>
                    <p className="text-xs text-on-surface-variant mt-1">Permanently delete all thoughts, conversations, and embeddings.</p>
                  </div>
                  <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-error-container/20 text-error hover:bg-error-container/30 transition-all">
                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                    Clear
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* About */}
          {activeTab === "about" && (
            <section>
              <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">About EchoMind</h3>
              <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-4">
                <div className="flex items-center gap-4">
                  <img src="/logo.svg" alt="EchoMind" className="w-12 h-12" />
                  <div>
                    <h4 className="text-lg font-headline font-bold text-on-surface">EchoMind</h4>
                    <p className="text-xs text-on-surface-variant">Cognitive Sanctuary · v0.1.0</p>
                  </div>
                </div>
                <div className="h-px w-full bg-outline-variant/10" />
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  An AI-powered thinking partner that captures, enriches, and interrogates your inspirations. Built with Tauri, React, and Rust.
                </p>
              </div>
            </section>
          )}

          {/* Save button - always visible */}
          <div className="flex justify-end gap-4 pt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-bold hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SKILL_TEMPLATE = `---
name: my-skill
description: What this skill does
trigger: manual
parameters:
  topic:
    type: string
    description: The topic to focus on
---

Your prompt template here. Use {{topic}} for parameters.
`;

function SkillsTab({ inputClass, labelClass }: { inputClass: string; labelClass: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsDir, setSkillsDir] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<string | null>(null); // filename being edited
  const [editorContent, setEditorContent] = useState("");
  const [editorFilename, setEditorFilename] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredSkill[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const loadSkills = () => {
    invoke<Skill[]>("list_skills").then(setSkills).catch(() => {});
    invoke<string>("get_skills_dir").then(setSkillsDir).catch(() => {});
  };

  useEffect(() => { loadSkills(); }, []);

  const handleScan = async () => {
    setScanning(true);
    setScanDone(false);
    setSelected(new Set());
    try {
      const results = await invoke<DiscoveredSkill[]>("scan_external_skills");
      // Filter out skills that are already installed
      const existingNames = new Set(skills.map((s) => s.name));
      setDiscovered(results.filter((d) => !existingNames.has(d.name)));
      setScanDone(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === discovered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(discovered.map((d) => d.path)));
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    let imported = 0;
    for (const d of discovered) {
      if (!selected.has(d.path)) continue;
      try {
        await invoke("import_external_skill", { name: d.name, content: d.content });
        imported++;
      } catch (e) {
        setError(`Failed to import ${d.name}: ${e}`);
        break;
      }
    }
    setImporting(false);
    if (imported > 0) {
      loadSkills();
      // Remove imported ones from discovered list
      setDiscovered((prev) => prev.filter((d) => !selected.has(d.path)));
      setSelected(new Set());
    }
  };

  const handleSave = async () => {
    setError(null);
    const filename = editorFilename.endsWith(".md") ? editorFilename : `${editorFilename}.md`;
    try {
      await invoke("save_skill", { filename, content: editorContent });
      setEditing(null);
      setCreating(false);
      setEditorContent("");
      setEditorFilename("");
      loadSkills();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await invoke("delete_skill", { filename: `${name}.md` });
      setDeleteTarget(null);
      loadSkills();
    } catch (e) {
      setError(String(e));
    }
  };

  const startEdit = (skill: Skill) => {
    // Reconstruct the markdown file content from the skill object
    const params = Object.entries(skill.parameters);
    let yaml = `---\nname: ${skill.name}\ndescription: ${skill.description}\ntrigger: ${skill.trigger}`;
    if (params.length > 0) {
      yaml += "\nparameters:";
      for (const [key, param] of params) {
        yaml += `\n  ${key}:\n    type: ${param.param_type}\n    description: ${param.description}`;
        if (param.default) yaml += `\n    default: ${param.default}`;
      }
    }
    yaml += "\n---\n\n" + skill.body;
    setEditorContent(yaml);
    setEditorFilename(`${skill.name}.md`);
    setEditing(skill.name);
    setCreating(false);
    setError(null);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const startCreate = () => {
    setEditorContent(SKILL_TEMPLATE);
    setEditorFilename("new-skill.md");
    setCreating(true);
    setEditing(null);
    setError(null);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const isEditorOpen = editing !== null || creating;

  return (
    <>
      {/* Skills list */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary">Skills</h3>
          <button
            onClick={startCreate}
            disabled={isEditorOpen}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Skill
          </button>
        </div>

        {/* Skills directory info */}
        {skillsDir && (
          <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl bg-surface-container-low ghost-border">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40">folder</span>
            <span className="text-xs text-on-surface-variant/60 truncate flex-1 font-mono">{skillsDir}</span>
          </div>
        )}

        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className="bg-surface-container-low rounded-2xl ghost-border p-5 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold text-on-surface text-sm">{skill.name}</h4>
                    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      skill.trigger === "auto"
                        ? "bg-primary/10 text-primary"
                        : skill.trigger === "both"
                        ? "bg-tertiary/10 text-tertiary"
                        : "bg-surface-container-highest text-on-surface-variant"
                    }`}>
                      {skill.trigger}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant/60 mt-1">{skill.description}</p>
                  {Object.keys(skill.parameters).length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {Object.entries(skill.parameters).map(([key, param]) => (
                        <span
                          key={key}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surface-container-highest text-on-surface-variant/60"
                          title={param.description}
                        >
                          {`{{${key}}}`}{param.default ? ` = ${param.default}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-4">
                  <button
                    onClick={() => startEdit(skill)}
                    disabled={isEditorOpen}
                    className="p-2 rounded-lg text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high transition-all disabled:opacity-30"
                    title="Edit"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={() => setDeleteTarget(skill.name)}
                    className="p-2 rounded-lg text-on-surface-variant/40 hover:text-error hover:bg-error-container/10 transition-all"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {skills.length === 0 && (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/15 mb-3 block">bolt</span>
              <p className="text-sm text-on-surface-variant/40">No skills yet</p>
              <p className="text-xs text-on-surface-variant/30 mt-1">Create one or drop .md files into the skills folder</p>
            </div>
          )}
        </div>
      </section>

      {/* Import from AI tools */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary">
            Import from AI Tools
          </h3>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
          >
            {scanning ? (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[16px]">radar</span>
            )}
            {scanning ? "Scanning..." : "Scan"}
          </button>
        </div>

        <div className="bg-surface-container-low rounded-2xl ghost-border p-5">
          {!scanDone && !scanning && (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[32px] text-on-surface-variant/15 mb-3 block">search</span>
              <p className="text-xs text-on-surface-variant/40">
                Scan ~/.claude, ~/.cursor, ~/.codex for importable skills
              </p>
            </div>
          )}

          {scanning && (
            <div className="text-center py-8">
              <span className="material-symbols-outlined animate-spin text-[28px] text-primary/40 mb-3 block">progress_activity</span>
              <p className="text-xs text-on-surface-variant/40">Scanning AI tool directories...</p>
            </div>
          )}

          {scanDone && discovered.length === 0 && (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[32px] text-on-surface-variant/15 mb-3 block">check_circle</span>
              <p className="text-xs text-on-surface-variant/40">No new skills found (all already imported)</p>
            </div>
          )}

          {scanDone && discovered.length > 0 && (
            <div className="space-y-3">
              {/* Select all / Import bar */}
              <div className="flex items-center justify-between px-1 mb-2">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {selected.size === discovered.length ? "check_box" : selected.size > 0 ? "indeterminate_check_box" : "check_box_outline_blank"}
                  </span>
                  {selected.size === discovered.length ? "Deselect all" : "Select all"}
                  <span className="text-on-surface-variant/40">({discovered.length} found)</span>
                </button>
                {selected.size > 0 && (
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg bg-primary text-on-primary hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    {importing ? (
                      <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[14px]">download</span>
                    )}
                    Import {selected.size}
                  </button>
                )}
              </div>

              {/* Skill cards */}
              {discovered.map((d) => {
                const isSelected = selected.has(d.path);
                return (
                  <button
                    key={d.path}
                    onClick={() => toggleSelect(d.path)}
                    className={`w-full text-left p-4 rounded-xl transition-all ghost-border flex items-start gap-3 ${
                      isSelected ? "bg-primary/5 border-primary/20" : "bg-surface-container hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">
                      {isSelected ? "check_box" : "check_box_outline_blank"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-on-surface">{d.name}</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant/60">
                          {d.source}
                        </span>
                      </div>
                      {d.description && (
                        <p className="text-xs text-on-surface-variant/50 mt-1 line-clamp-2">{d.description}</p>
                      )}
                      <p className="text-[9px] text-on-surface-variant/30 mt-1 font-mono truncate">{d.path}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Editor */}
      {isEditorOpen && (
        <section>
          <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">
            {creating ? "Create Skill" : `Edit: ${editing}`}
          </h3>
          <div className="bg-surface-container-low rounded-2xl ghost-border p-6 space-y-4">
            <div className="space-y-2">
              <label className={labelClass}>Filename</label>
              <input
                type="text"
                value={editorFilename}
                onChange={(e) => setEditorFilename(e.target.value)}
                placeholder="my-skill.md"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Content (YAML frontmatter + Markdown)</label>
              <textarea
                ref={editorRef}
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                rows={16}
                spellCheck={false}
                className={`${inputClass} font-mono text-xs leading-relaxed resize-y min-h-[200px]`}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-error bg-error-container/20 rounded-xl px-4 py-3">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {error}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setEditing(null); setCreating(false); setError(null); }}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant ghost-border hover:bg-surface-container-high transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary text-on-primary hover:brightness-110 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                Save
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container rounded-3xl ghost-border p-6 w-[360px] shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="material-symbols-outlined text-error">warning</span>
              <h3 className="font-headline font-bold text-sm text-on-surface">Delete Skill</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-5">
              Are you sure you want to delete <strong>{deleteTarget}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-on-surface-variant ghost-border hover:bg-surface-container-high transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-error text-on-error hover:brightness-110 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AppearanceTab({ labelClass }: { labelClass: string }) {
  const { theme, setTheme } = useThemeStore();
  const themes = [
    { key: "dark" as const, label: "Dark", icon: "dark_mode" },
    { key: "light" as const, label: "Light", icon: "light_mode" },
    { key: "system" as const, label: "System", icon: "desktop_windows" },
  ];

  return (
    <section>
      <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-primary mb-6">Appearance</h3>
      <div className="bg-surface-container-low rounded-2xl p-6 ghost-border space-y-6">
        <div className="space-y-2">
          <label className={labelClass}>Theme</label>
          <div className="flex gap-3">
            {themes.map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  theme === t.key
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-highest text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-px w-full bg-outline-variant/10" />
        <ToggleRow
          title="Compact Mode"
          desc="Reduce spacing and font sizes for denser layouts."
        />
        <div className="h-px w-full bg-outline-variant/10" />
        <div className="space-y-2">
          <label className={labelClass}>Font Size</label>
          <input type="range" min="12" max="20" defaultValue="14" className="w-full accent-primary" />
          <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
            <span>12px</span>
            <span>16px</span>
            <span>20px</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ToggleRow({ title, desc, defaultOn = false }: { title: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between">
      <div>
        <h4 className="font-medium text-on-surface text-sm">{title}</h4>
        <p className="text-xs text-on-surface-variant mt-1">{desc}</p>
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`w-11 h-6 rounded-full relative transition-colors ${on ? "bg-primary" : "bg-surface-container-highest"}`}
      >
        <div className={`absolute top-1 w-4 h-4 bg-on-primary rounded-full transition-all ${on ? "right-1" : "left-1"}`} />
      </button>
    </div>
  );
}
