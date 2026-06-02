import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMsg } from "../lib/errorMsg";
import { invoke } from "@tauri-apps/api/core";

interface RemoteLlmStatus {
  has_llm_config: boolean;
  llm_disabled: boolean;
  usage_cents: number;
  budget_cents: number | null;
}

interface SubsetRules {
  time_window_days?: number | null;
  include_tags: string[];
  exclude_tags: string[];
  exclude_archived?: boolean | null;
}

interface Status {
  paired: boolean;
  enabled: boolean;
  server_url: string | null;
  device_id: string | null;
  sync_key_fp: string | null;
  rules: SubsetRules;
  llm_via_bridge: boolean;
}

const emptyRules: SubsetRules = {
  time_window_days: null,
  include_tags: [],
  exclude_tags: [],
  exclude_archived: true,
};

export default function CloudBridgePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [serverUrl, setServerUrl] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [pairing, setPairing] = useState(false);

  const [rulesDraft, setRulesDraft] = useState<SubsetRules>(emptyRules);
  const [includeTagsInput, setIncludeTagsInput] = useState("");
  const [excludeTagsInput, setExcludeTagsInput] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [consent, setConsent] = useState(false);

  const [llmStatus, setLlmStatus] = useState<RemoteLlmStatus | null>(null);
  const [llmConsent, setLlmConsent] = useState(false);
  const [llmBudget, setLlmBudget] = useState("");
  const [llmPushing, setLlmPushing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await invoke<Status>("cloud_bridge_status");
      setStatus(s);
      setRulesDraft({
        time_window_days: s.rules.time_window_days ?? null,
        include_tags: s.rules.include_tags ?? [],
        exclude_tags: s.rules.exclude_tags ?? [],
        exclude_archived: s.rules.exclude_archived ?? true,
      });
      setIncludeTagsInput((s.rules.include_tags ?? []).join(", "));
      setExcludeTagsInput((s.rules.exclude_tags ?? []).join(", "));
      if (s.server_url) setServerUrl(s.server_url);
      if (s.paired) {
        try {
          const ls = await invoke<RemoteLlmStatus>("cloud_bridge_remote_llm_status");
          setLlmStatus(ls);
        } catch {
          setLlmStatus(null);
        }
      }
    } catch (e) {
      setError(errorMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePair = async () => {
    if (!consent) {
      setError(t("cloud_bridge.consent_required"));
      return;
    }
    if (!serverUrl.trim() || !deviceCode.trim()) {
      setError(t("cloud_bridge.fields_required"));
      return;
    }
    setPairing(true);
    setError(null);
    setInfo(null);
    try {
      const deviceId = await invoke<string>("cloud_bridge_pair", {
        args: { server_url: serverUrl.trim(), device_code: deviceCode.trim() },
      });
      setInfo(t("cloud_bridge.pair_success", { deviceId }));
      setDeviceCode("");
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    } finally {
      setPairing(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!status) return;
    try {
      await invoke("cloud_bridge_set_enabled", { enabled: !status.enabled });
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handleToggleLlmViaBridge = async () => {
    if (!status) return;
    try {
      await invoke("cloud_bridge_set_llm_via_bridge", {
        enabled: !status.llm_via_bridge,
      });
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handleSaveRules = async () => {
    setSavingRules(true);
    setError(null);
    setInfo(null);
    try {
      const payload: SubsetRules = {
        time_window_days: rulesDraft.time_window_days ?? null,
        include_tags: parseTags(includeTagsInput),
        exclude_tags: parseTags(excludeTagsInput),
        exclude_archived: rulesDraft.exclude_archived ?? true,
      };
      await invoke("cloud_bridge_set_rules", { rules: payload });
      setInfo(t("cloud_bridge.rules_saved"));
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    } finally {
      setSavingRules(false);
    }
  };

  const handleInitialSync = async () => {
    setError(null);
    setInfo(null);
    try {
      const n = await invoke<number>("cloud_bridge_initial_sync");
      setInfo(t("cloud_bridge.initial_sync_done", { count: n }));
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handleSyncPull = async () => {
    setError(null);
    setInfo(null);
    try {
      const n = await invoke<number>("cloud_bridge_sync_pull");
      setInfo(n > 0 ? t("cloud_bridge.pull_done", { count: n }) : t("cloud_bridge.pull_empty"));
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handlePushLlm = async () => {
    if (!llmConsent) { setError(t("cloud_bridge.consent_llm_required")); return; }
    setLlmPushing(true);
    setError(null);
    setInfo(null);
    try {
      const budgetCents = llmBudget.trim() !== ""
        ? Math.round(parseFloat(llmBudget) * 100)
        : null;
      await invoke("cloud_bridge_push_llm_config", { budgetCents });
      setInfo(t("cloud_bridge.llm_pushed"));
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    } finally {
      setLlmPushing(false);
    }
  };

  const handleClearLlm = async () => {
    if (!confirm(t("cloud_bridge.llm_clear_confirm"))) return;
    setError(null);
    setInfo(null);
    try {
      await invoke("cloud_bridge_clear_llm_config");
      setInfo(t("cloud_bridge.llm_cleared"));
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handleTerminate = async () => {
    if (!confirm(t("cloud_bridge.terminate_confirm"))) return;
    setError(null);
    setInfo(null);
    try {
      await invoke("cloud_bridge_terminate");
      setInfo(t("cloud_bridge.terminated"));
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  const handleResetLocal = async () => {
    if (!confirm(t("cloud_bridge.reset_local_confirm"))) return;
    setError(null);
    setInfo(null);
    try {
      await invoke("cloud_bridge_reset_local");
      setInfo(t("cloud_bridge.local_reset_done"));
      await refresh();
    } catch (e) {
      setError(errorMsg(e));
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-on-surface-variant/60">{t("cloud_bridge.loading")}</div>
    );
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">{t("cloud_bridge.title")}</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          {t("cloud_bridge.subtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
          {info}
        </div>
      )}

      {!status?.paired ? (
        <PairForm
          serverUrl={serverUrl}
          setServerUrl={setServerUrl}
          deviceCode={deviceCode}
          setDeviceCode={setDeviceCode}
          consent={consent}
          setConsent={setConsent}
          pairing={pairing}
          onPair={handlePair}
        />
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl bg-surface-container-low border border-outline-variant/20 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-on-surface">{t("cloud_bridge.subscription_status")}</h2>
                <p className="text-xs text-on-surface-variant/60 font-mono mt-1">
                  {status.server_url}
                </p>
                <p className="text-xs text-on-surface-variant/60 font-mono">
                  device: {status.device_id}
                </p>
                {status.sync_key_fp && (
                  <p
                    className="text-xs text-on-surface-variant/60 font-mono cursor-pointer hover:text-primary"
                    title={t("cloud_bridge.sync_fp_copy_title")}
                    onClick={() => {
                      navigator.clipboard?.writeText(status.sync_key_fp!);
                      setInfo(t("cloud_bridge.sync_fp_copied"));
                      setTimeout(() => setInfo(null), 2000);
                    }}
                  >
                    sync_key_fp: {status.sync_key_fp}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-on-surface-variant/70">
                  {status.enabled ? t("cloud_bridge.syncing") : t("cloud_bridge.paused")}
                </span>
                <input
                  type="checkbox"
                  checked={status.enabled}
                  onChange={handleToggleEnabled}
                  className="w-10 h-5 appearance-none rounded-full bg-surface-container-high checked:bg-primary relative cursor-pointer transition-colors
                    before:absolute before:w-4 before:h-4 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 before:transition-transform
                    checked:before:translate-x-5"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-4 pt-3 mt-3 border-t border-outline-variant/20">
              <div>
                <p className="text-sm text-on-surface">{t("cloud_bridge.rebind_title")}</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  {t("cloud_bridge.rebind_desc")}
                </p>
              </div>
              <button
                onClick={handleResetLocal}
                className="shrink-0 px-3 py-1.5 rounded-lg text-sm bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-primary transition-colors"
              >
                {t("cloud_bridge.rebind_button")}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 pt-3 mt-3 border-t border-outline-variant/20">
              <div>
                <p className="text-sm text-on-surface">{t("cloud_bridge.llm_via_bridge_title")}</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  {t("cloud_bridge.llm_via_bridge_desc")}
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer shrink-0">
                <span className="text-sm text-on-surface-variant/70">
                  {status.llm_via_bridge ? t("cloud_bridge.via_enabled") : t("cloud_bridge.via_disabled")}
                </span>
                <input
                  type="checkbox"
                  checked={status.llm_via_bridge}
                  onChange={handleToggleLlmViaBridge}
                  className="w-10 h-5 appearance-none rounded-full bg-surface-container-high checked:bg-primary relative cursor-pointer transition-colors
                    before:absolute before:w-4 before:h-4 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 before:transition-transform
                    checked:before:translate-x-5"
                />
              </label>
            </div>
          </section>

          <details className="rounded-xl bg-surface-container-low border border-outline-variant/20 [&[open]]:p-5 group">
            <summary className="cursor-pointer p-5 [&::-webkit-details-marker]:hidden flex items-center justify-between group-[[open]]:pb-3">
              <div>
                <h2 className="font-semibold text-on-surface">{t("cloud_bridge.rules_section_title")}</h2>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  {t("cloud_bridge.rules_section_desc")}
                </p>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/40 transition-transform group-[[open]]:rotate-180">expand_more</span>
            </summary>
            <div className="space-y-4">

            <div>
              <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.time_window")}</label>
              <input
                type="number"
                min={0}
                placeholder={t("cloud_bridge.time_window_placeholder")}
                value={rulesDraft.time_window_days ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(0, parseInt(e.target.value) || 0);
                  setRulesDraft({ ...rulesDraft, time_window_days: v });
                }}
                className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.include_tags")}</label>
              <input
                type="text"
                value={includeTagsInput}
                onChange={(e) => setIncludeTagsInput(e.target.value)}
                placeholder={t("cloud_bridge.include_placeholder")}
                className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
              <p className="text-[11px] text-on-surface-variant/40 mt-1">{t("cloud_bridge.include_hint")}</p>
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.exclude_tags")}</label>
              <input
                type="text"
                value={excludeTagsInput}
                onChange={(e) => setExcludeTagsInput(e.target.value)}
                placeholder={t("cloud_bridge.exclude_placeholder")}
                className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-on-surface-variant/80">
              <input
                type="checkbox"
                checked={rulesDraft.exclude_archived ?? true}
                onChange={(e) =>
                  setRulesDraft({ ...rulesDraft, exclude_archived: e.target.checked })
                }
              />
              {t("cloud_bridge.exclude_archived")}
            </label>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveRules}
                disabled={savingRules}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {savingRules ? t("cloud_bridge.saving_rules") : t("cloud_bridge.save_rules")}
              </button>
              <button
                onClick={handleInitialSync}
                className="px-4 py-2 bg-surface-container-high text-on-surface rounded-lg text-sm font-medium"
              >
                {t("cloud_bridge.full_sync_now")}
              </button>
              <button
                onClick={handleSyncPull}
                className="px-4 py-2 bg-surface-container-high text-on-surface rounded-lg text-sm font-medium"
              >
                {t("cloud_bridge.pull_now")}
              </button>
            </div>
            </div>
          </details>

          <details className="rounded-xl bg-surface-container-low border border-outline-variant/20 [&[open]]:p-5 group">
            <summary className="cursor-pointer p-5 [&::-webkit-details-marker]:hidden flex items-center justify-between group-[[open]]:pb-3">
              <div>
                <h2 className="font-semibold text-on-surface">{t("cloud_bridge.llm_section_title")}</h2>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  {t("cloud_bridge.llm_section_desc_a")}<code className="font-mono">/chat</code>{t("cloud_bridge.llm_section_desc_b")}
                </p>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/40 transition-transform group-[[open]]:rotate-180">expand_more</span>
            </summary>
            <div className="space-y-4">

            {llmStatus && (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">{t("cloud_bridge.config_status")}</p>
                  <p className={llmStatus.has_llm_config ? "text-green-400" : "text-on-surface-variant/60"}>
                    {llmStatus.has_llm_config ? t("cloud_bridge.uploaded") : t("cloud_bridge.not_configured")}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">{t("cloud_bridge.used_quota")}</p>
                  <p className="text-on-surface">${(llmStatus.usage_cents / 100).toFixed(3)}</p>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">{t("cloud_bridge.budget_cap")}</p>
                  <p className={llmStatus.llm_disabled ? "text-red-400" : "text-on-surface"}>
                    {llmStatus.llm_disabled
                      ? t("cloud_bridge.disabled_overrun")
                      : llmStatus.budget_cents != null
                        ? `$${(llmStatus.budget_cents / 100).toFixed(2)}`
                        : t("cloud_bridge.unlimited")}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-4 space-y-2">
              <p className="text-xs text-on-surface-variant/80 font-medium">{t("cloud_bridge.llm_warning_title")}</p>
              <ul className="text-xs text-on-surface-variant/70 space-y-1 list-disc list-inside">
                <li>{t("cloud_bridge.llm_warn_1")}</li>
                <li>{t("cloud_bridge.llm_warn_2")}</li>
                <li>{t("cloud_bridge.llm_warn_3")}</li>
              </ul>
              <label className="flex items-center gap-2 text-sm text-on-surface mt-2">
                <input
                  type="checkbox"
                  checked={llmConsent}
                  onChange={(e) => setLlmConsent(e.target.checked)}
                />
                {t("cloud_bridge.llm_consent")}
              </label>
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.budget_label")}</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={llmBudget}
                onChange={(e) => setLlmBudget(e.target.value)}
                placeholder={t("cloud_bridge.budget_placeholder")}
                className="mt-1 w-48 bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handlePushLlm}
                disabled={llmPushing || !llmConsent}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {llmPushing ? t("cloud_bridge.pushing_llm") : llmStatus?.has_llm_config ? t("cloud_bridge.update_llm") : t("cloud_bridge.push_llm")}
              </button>
              {llmStatus?.has_llm_config && (
                <button
                  onClick={handleClearLlm}
                  className="px-4 py-2 bg-surface-container-high text-on-surface/70 hover:text-error rounded-lg text-sm font-medium"
                >
                  {t("cloud_bridge.clear_llm")}
                </button>
              )}
            </div>
            </div>
          </details>

          <details className="rounded-xl bg-red-500/5 border border-red-500/20 [&[open]]:p-5 group">
            <summary className="cursor-pointer p-5 [&::-webkit-details-marker]:hidden flex items-center justify-between group-[[open]]:pb-3">
              <div>
                <h2 className="font-semibold text-on-surface">{t("cloud_bridge.danger_section_title")}</h2>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  {t("cloud_bridge.danger_section_desc")}
                </p>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/40 transition-transform group-[[open]]:rotate-180">expand_more</span>
            </summary>
            <div>
              <p className="text-xs text-on-surface-variant/60 mb-3">
                {t("cloud_bridge.terminate_desc")}
              </p>
              <button
                onClick={handleTerminate}
                className="px-4 py-2 bg-red-500/80 hover:bg-red-500 text-white rounded-lg text-sm font-medium"
              >
                {t("cloud_bridge.terminate_button")}
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function parseTags(s: string): string[] {
  return s
    .split(/[,，;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

interface PairFormProps {
  serverUrl: string;
  setServerUrl: (s: string) => void;
  deviceCode: string;
  setDeviceCode: (s: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  pairing: boolean;
  onPair: () => void;
}

function PairForm(p: PairFormProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-5">
        <h2 className="font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-amber-400">warning</span>
          {t("cloud_bridge.privacy_title")}
        </h2>
        <p className="mt-2 text-xs text-on-surface-variant/80">
          {t("cloud_bridge.privacy_summary")}
        </p>
        <details className="mt-2">
          <summary className="text-xs text-on-surface-variant/60 cursor-pointer hover:text-on-surface">{t("cloud_bridge.privacy_details")}</summary>
          <ul className="mt-2 text-xs text-on-surface-variant/70 space-y-1.5 list-disc list-inside">
            <li>{t("cloud_bridge.privacy_detail_1")}</li>
            <li>{t("cloud_bridge.privacy_detail_2")}</li>
            <li>{t("cloud_bridge.privacy_detail_3")}</li>
            <li>{t("cloud_bridge.privacy_detail_4")}</li>
          </ul>
        </details>
        <label className="mt-3 flex items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={p.consent}
            onChange={(e) => p.setConsent(e.target.checked)}
          />
          {t("cloud_bridge.privacy_consent")}
        </label>
      </section>

      <section className="rounded-xl bg-surface-container-low border border-outline-variant/20 p-5 space-y-4">
        <h2 className="font-semibold text-on-surface">{t("cloud_bridge.pair_section_title")}</h2>
        <div>
          <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.server_url")}</label>
          <input
            type="text"
            value={p.serverUrl}
            onChange={(e) => p.setServerUrl(e.target.value)}
            placeholder="https://bridge.example.com"
            className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant/70">{t("cloud_bridge.device_code")}</label>
          <input
            type="text"
            value={p.deviceCode}
            onChange={(e) => p.setDeviceCode(e.target.value.toUpperCase())}
            placeholder={t("cloud_bridge.device_code_placeholder")}
            className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30 font-mono tracking-widest uppercase"
          />
          <p className="text-[11px] text-on-surface-variant/40 mt-1">
            {t("cloud_bridge.device_code_hint_a")}<code className="font-mono">POST /admin/pair-codes</code>{t("cloud_bridge.device_code_hint_b")}
          </p>
        </div>
        <button
          onClick={p.onPair}
          disabled={p.pairing || !p.consent}
          className="w-full py-2.5 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {p.pairing ? t("cloud_bridge.pairing") : t("cloud_bridge.pair_button")}
        </button>
      </section>
    </div>
  );
}
