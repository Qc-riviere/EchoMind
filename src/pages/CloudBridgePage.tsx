import { useCallback, useEffect, useState } from "react";
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
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePair = async () => {
    if (!consent) {
      setError("请先确认知情同意");
      return;
    }
    if (!serverUrl.trim() || !deviceCode.trim()) {
      setError("服务器地址和配对码不能为空");
      return;
    }
    setPairing(true);
    setError(null);
    setInfo(null);
    try {
      const deviceId = await invoke<string>("cloud_bridge_pair", {
        args: { server_url: serverUrl.trim(), device_code: deviceCode.trim() },
      });
      setInfo(`配对成功，设备 ID: ${deviceId}`);
      setDeviceCode("");
      await refresh();
    } catch (e) {
      setError(String(e));
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
      setError(String(e));
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
      setError(String(e));
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
      setInfo("规则已保存");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingRules(false);
    }
  };

  const handleInitialSync = async () => {
    setError(null);
    setInfo(null);
    try {
      const n = await invoke<number>("cloud_bridge_initial_sync");
      setInfo(`已上传 ${n} 条想法到云端`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSyncPull = async () => {
    setError(null);
    setInfo(null);
    try {
      const n = await invoke<number>("cloud_bridge_sync_pull");
      setInfo(n > 0 ? `已从云端拉取 ${n} 条新想法` : "云端无新增");
    } catch (e) {
      setError(String(e));
    }
  };

  const handlePushLlm = async () => {
    if (!llmConsent) { setError("请先勾选知情同意"); return; }
    setLlmPushing(true);
    setError(null);
    setInfo(null);
    try {
      const budgetCents = llmBudget.trim() !== ""
        ? Math.round(parseFloat(llmBudget) * 100)
        : null;
      await invoke("cloud_bridge_push_llm_config", { budgetCents });
      setInfo("LLM 配置已推送到 VPS");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLlmPushing(false);
    }
  };

  const handleClearLlm = async () => {
    if (!confirm("这将从 VPS 删除 LLM 配置，微信 /chat 将无法远程调用。确认？")) return;
    setError(null);
    setInfo(null);
    try {
      await invoke("cloud_bridge_clear_llm_config");
      setInfo("LLM 配置已从 VPS 清除");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleTerminate = async () => {
    if (!confirm("终止订阅将立即销毁云端数据，并清除本地绑定。确认继续？")) return;
    setError(null);
    setInfo(null);
    try {
      await invoke("cloud_bridge_terminate");
      setInfo("已终止订阅并清除云端数据");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-on-surface-variant/60">Loading...</div>
    );
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Cloud Bridge</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          把筛选后的想法同步到你的 VPS，让微信 bot 在电脑关机时也能工作。
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
                <h2 className="font-semibold text-on-surface">订阅状态</h2>
                <p className="text-xs text-on-surface-variant/60 font-mono mt-1">
                  {status.server_url}
                </p>
                <p className="text-xs text-on-surface-variant/60 font-mono">
                  device: {status.device_id}
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-on-surface-variant/70">
                  {status.enabled ? "同步中" : "已暂停"}
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
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-outline-variant/20">
              <div>
                <p className="text-sm text-on-surface">通过云桥调用 LLM</p>
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  开启后桌面 AI 调用经 VPS 转发，绕过本地地理封锁。需要先在下方推送 LLM 配置到 VPS。
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer shrink-0">
                <span className="text-sm text-on-surface-variant/70">
                  {status.llm_via_bridge ? "已启用" : "未启用"}
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

          <section className="rounded-xl bg-surface-container-low border border-outline-variant/20 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-on-surface">上云子集规则</h2>
              <p className="text-xs text-on-surface-variant/60 mt-1">
                只有匹配规则的想法会推送到云端。规则变更后，不再匹配的想法会自动从云端删除。
              </p>
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">时间窗（天）</label>
              <input
                type="number"
                min={0}
                placeholder="留空 = 不限"
                value={rulesDraft.time_window_days ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(0, parseInt(e.target.value) || 0);
                  setRulesDraft({ ...rulesDraft, time_window_days: v });
                }}
                className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">包含标签（任一命中即推送，逗号分隔）</label>
              <input
                type="text"
                value={includeTagsInput}
                onChange={(e) => setIncludeTagsInput(e.target.value)}
                placeholder="例如：work, research"
                className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
              <p className="text-[10px] text-on-surface-variant/40 mt-1">留空 = 不按包含标签过滤</p>
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">排除标签（命中任一则跳过）</label>
              <input
                type="text"
                value={excludeTagsInput}
                onChange={(e) => setExcludeTagsInput(e.target.value)}
                placeholder="例如：private, 隐私"
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
              排除归档的想法
            </label>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveRules}
                disabled={savingRules}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {savingRules ? "保存中..." : "保存规则"}
              </button>
              <button
                onClick={handleInitialSync}
                className="px-4 py-2 bg-surface-container-high text-on-surface rounded-lg text-sm font-medium"
              >
                立即全量同步
              </button>
              <button
                onClick={handleSyncPull}
                className="px-4 py-2 bg-surface-container-high text-on-surface rounded-lg text-sm font-medium"
              >
                拉取云端新增
              </button>
            </div>
          </section>

          <section className="rounded-xl bg-surface-container-low border border-outline-variant/20 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-on-surface">LLM 远程执行（可选）</h2>
              <p className="text-xs text-on-surface-variant/60 mt-1">
                把本地 LLM 密钥推送到 VPS，让微信 <code className="font-mono">/chat</code> 在手机端直接调用 AI，无需桌面在线。
              </p>
            </div>

            {llmStatus && (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">配置状态</p>
                  <p className={llmStatus.has_llm_config ? "text-green-400" : "text-on-surface-variant/60"}>
                    {llmStatus.has_llm_config ? "已上传" : "未配置"}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">已用额度</p>
                  <p className="text-on-surface">${(llmStatus.usage_cents / 100).toFixed(3)}</p>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <p className="text-on-surface-variant/50 mb-0.5">预算上限</p>
                  <p className={llmStatus.llm_disabled ? "text-red-400" : "text-on-surface"}>
                    {llmStatus.llm_disabled
                      ? "已禁用（超限）"
                      : llmStatus.budget_cents != null
                        ? `$${(llmStatus.budget_cents / 100).toFixed(2)}`
                        : "不限"}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-4 space-y-2">
              <p className="text-xs text-on-surface-variant/80 font-medium">⚠ 推送前请确认：</p>
              <ul className="text-xs text-on-surface-variant/70 space-y-1 list-disc list-inside">
                <li>LLM API Key 将用服务端主密钥加密后存储，VPS 管理员有解密能力。</li>
                <li>每次远程 /chat 均从你的 API 配额扣费，建议设置预算上限。</li>
                <li>可随时点"清除"撤销，或在"危险区"销毁全部数据。</li>
              </ul>
              <label className="flex items-center gap-2 text-sm text-on-surface mt-2">
                <input
                  type="checkbox"
                  checked={llmConsent}
                  onChange={(e) => setLlmConsent(e.target.checked)}
                />
                我了解上述风险，同意推送 LLM 密钥
              </label>
            </div>

            <div>
              <label className="text-xs text-on-surface-variant/70">预算上限（USD，留空 = 不限）</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={llmBudget}
                onChange={(e) => setLlmBudget(e.target.value)}
                placeholder="例如：5.00"
                className="mt-1 w-48 bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handlePushLlm}
                disabled={llmPushing || !llmConsent}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {llmPushing ? "推送中..." : llmStatus?.has_llm_config ? "更新 LLM 配置" : "推送 LLM 配置"}
              </button>
              {llmStatus?.has_llm_config && (
                <button
                  onClick={handleClearLlm}
                  className="px-4 py-2 bg-surface-container-high text-on-surface/70 hover:text-error rounded-lg text-sm font-medium"
                >
                  清除 LLM 配置
                </button>
              )}
            </div>
          </section>

          <section className="rounded-xl bg-red-500/5 border border-red-500/20 p-5">
            <h2 className="font-semibold text-on-surface">危险区</h2>
            <p className="text-xs text-on-surface-variant/60 mt-1">
              终止订阅会立即销毁云端的所有想法副本、微信 bot 配置和可选的 LLM 密钥。
            </p>
            <button
              onClick={handleTerminate}
              className="mt-3 px-4 py-2 bg-red-500/80 hover:bg-red-500 text-white rounded-lg text-sm font-medium"
            >
              终止订阅并销毁云端数据
            </button>
          </section>
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
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-5">
        <h2 className="font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-amber-400">warning</span>
          知情同意
        </h2>
        <ul className="mt-3 text-xs text-on-surface-variant/80 space-y-1.5 list-disc list-inside">
          <li>启用云端桥接意味着你匹配规则的想法会以明文存储在你的 VPS 上。</li>
          <li>服务端持有完整子集数据，可用于微信 bot 离线访问，不是端到端加密。</li>
          <li>微信 bot_token 和可选的 LLM 密钥加密存储，但 VPS 管理员仍有物理访问能力。</li>
          <li>随时可终止订阅，云端数据立即销毁。</li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={p.consent}
            onChange={(e) => p.setConsent(e.target.checked)}
          />
          我已阅读并理解上述隐私代价
        </label>
      </section>

      <section className="rounded-xl bg-surface-container-low border border-outline-variant/20 p-5 space-y-4">
        <h2 className="font-semibold text-on-surface">配对设备</h2>
        <div>
          <label className="text-xs text-on-surface-variant/70">VPS 服务器地址</label>
          <input
            type="text"
            value={p.serverUrl}
            onChange={(e) => p.setServerUrl(e.target.value)}
            placeholder="https://bridge.example.com"
            className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant/70">一次性配对码（由服务端生成）</label>
          <input
            type="text"
            value={p.deviceCode}
            onChange={(e) => p.setDeviceCode(e.target.value.toUpperCase())}
            placeholder="8 位字符"
            className="mt-1 w-full bg-surface-container rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary/30 font-mono tracking-widest uppercase"
          />
          <p className="text-[10px] text-on-surface-variant/40 mt-1">
            在你的 VPS 上执行 <code className="font-mono">POST /admin/pair-codes</code> 获取。
          </p>
        </div>
        <button
          onClick={p.onPair}
          disabled={p.pairing || !p.consent}
          className="w-full py-2.5 bg-primary text-on-primary rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {p.pairing ? "配对中..." : "配对并启用"}
        </button>
      </section>
    </div>
  );
}
