import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { errorMsg } from "../lib/errorMsg";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";

interface ServerStatus {
  online: boolean;
  thoughts?: number;
  archived?: number;
  conversations?: number;
}

interface WeChatAccount {
  configured: boolean;
  accountId?: string;
  createdAt?: string;
}

interface QrLoginInfo {
  qrcode_id: string;
  qrcode_url: string;
}

interface QrPollResult {
  status: string;
  account_id: string | null;
}

interface CloudBridgeStatus {
  paired: boolean;
  enabled: boolean;
  server_url: string | null;
  device_id: string | null;
}

type BridgeStep = "idle" | "starting-server" | "scanning" | "scanned" | "connecting" | "ready" | "error";

export default function WeChatBridgePage() {
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [account, setAccount] = useState<WeChatAccount | null>(null);
  const [daemonRunning, setDaemonRunning] = useState(false);
  const [cloudBridge, setCloudBridge] = useState<CloudBridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<BridgeStep>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [status, acct, daemon, cloud] = await Promise.all([
        invoke<ServerStatus>("bridge_server_status"),
        invoke<WeChatAccount>("bridge_wechat_account"),
        invoke<boolean>("bridge_daemon_status"),
        invoke<CloudBridgeStatus>("cloud_bridge_status").catch(() => null),
      ]);
      setServerStatus(status);
      setAccount(acct);
      setDaemonRunning(daemon);
      setCloudBridge(cloud);
      if (daemon && status.online && acct.configured) {
        setStep((prev) => (prev === "scanning" || prev === "scanned" ? prev : "ready"));
      }
    } catch {
      setServerStatus({ online: false });
      setAccount({ configured: false });
      setDaemonRunning(false);
      setCloudBridge(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i); }, [refresh]);
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const startConnect = async () => {
    setError(null);
    setActionLoading(true);
    try {
      if (!serverStatus?.online) {
        setStep("starting-server");
        await invoke("bridge_start_server");
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const status = await invoke<ServerStatus>("bridge_server_status");
          if (status.online) { setServerStatus(status); break; }
          if (i === 9) throw new Error(t("wechat_bridge.server_timeout"));
        }
      }
      setStep("scanning");
      const qr = await invoke<QrLoginInfo>("bridge_qr_start");
      setQrUrl(qr.qrcode_url);
      pollRef.current = setInterval(async () => {
        try {
          const result = await invoke<QrPollResult>("bridge_qr_poll", { qrcodeId: qr.qrcode_id });
          if (result.status === "scaned") setStep("scanned");
          else if (result.status === "confirmed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStep("connecting");
            await invoke("bridge_start_daemon");
            await new Promise((r) => setTimeout(r, 2000));
            setStep("ready");
            await refresh();
          } else if (result.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setError(t("wechat_bridge.qr_expired"));
            setStep("idle");
          }
        } catch {}
      }, 3000);
    } catch (e) {
      setError(errorMsg(e));
      setStep("error");
    } finally { setActionLoading(false); }
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try {
      await invoke("bridge_stop_daemon");
      await invoke("bridge_stop_server");
      setDaemonRunning(false);
      setServerStatus({ online: false });
      setStep("idle");
      setQrUrl(null);
    } catch {} finally { setActionLoading(false); }
  };

  const handleStartDaemon = async () => {
    setActionLoading(true);
    try {
      if (!serverStatus?.online) {
        await invoke("bridge_start_server");
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const status = await invoke<ServerStatus>("bridge_server_status");
          if (status.online) { setServerStatus(status); break; }
        }
      }
      await invoke<string>("bridge_start_daemon");
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
      setStep("ready");
    } catch (e) {
      setError(errorMsg(e));
      setStep("idle");
    } finally { setActionLoading(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
      </div>
    );
  }

  const isReady = serverStatus?.online && account?.configured && daemonRunning;
  const cloudActive = !!(cloudBridge?.paired && cloudBridge?.enabled);
  const bridgeHost = (() => {
    if (!cloudBridge?.server_url) return null;
    try { return new URL(cloudBridge.server_url).host; } catch { return cloudBridge.server_url; }
  })();

  return (
    <div className="max-w-5xl mx-auto px-8 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-headline font-bold text-on-surface tracking-tight">{t("wechat_bridge.title")}</h1>
        <p className="text-sm text-on-surface-variant mt-3 leading-relaxed max-w-2xl">
          {t("wechat_bridge.subtitle")}
        </p>
      </div>

      {/* Cloud-bridge mode banner — bot lives on the VPS, not on the desktop */}
      {cloudActive && !daemonRunning && (
        <div className="mb-6 px-5 py-4 rounded-2xl bg-primary/10 border border-primary/30 flex items-start gap-3">
          <span className="material-symbols-outlined text-primary mt-0.5" aria-hidden="true">cloud_done</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-on-surface">{t("wechat_bridge.cloud_active_title")}</div>
            <div className="text-xs text-on-surface-variant mt-1 leading-relaxed">
              {t("wechat_bridge.cloud_active_desc_a")}{bridgeHost ? ` (${bridgeHost})` : ""}{t("wechat_bridge.cloud_active_desc_b")}
            </div>
          </div>
        </div>
      )}

      {/* Status indicators */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatusCard icon="cloud" label={t("wechat_bridge.status_local_service")} value={serverStatus?.online ? t("wechat_bridge.status_online") : t("wechat_bridge.status_offline")} active={!!serverStatus?.online} />
        <StatusCard icon="person" label={t("wechat_bridge.status_account")} value={account?.accountId ? `@${account.accountId.slice(0, 8)}` : t("wechat_bridge.status_unbound")} active={!!account?.configured} />
        <StatusCard
          icon="hub"
          label={t("wechat_bridge.status_bridge")}
          value={daemonRunning ? t("wechat_bridge.status_running_local") : cloudActive ? t("wechat_bridge.status_running_cloud") : t("wechat_bridge.status_not_started")}
          active={daemonRunning || cloudActive}
        />
        <StatusCard icon="lock" label={t("wechat_bridge.status_encryption")} value="256-bit AES" active={!!isReady || cloudActive} />
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Main action area */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-surface-container-low p-8 rounded-2xl ghost-border">
            {step === "scanning" || step === "scanned" ? (
              <div className="text-center space-y-5">
                <h2 className="text-lg font-headline font-bold text-on-surface">
                  {step === "scanned" ? t("wechat_bridge.qr_title_scanned") : t("wechat_bridge.qr_title_default")}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {step === "scanned" ? t("wechat_bridge.qr_hint_scanned") : t("wechat_bridge.qr_hint_default")}
                </p>
                {qrUrl && (
                  <div className="inline-block p-5 bg-surface-container-lowest rounded-2xl">
                    <QRCodeSVG
                      value={qrUrl}
                      size={200}
                      level="M"
                      bgColor="transparent"
                      fgColor={step === "scanned" ? "#adc7ff" : "#e5e2e1"}
                    />
                  </div>
                )}
                {step === "scanned" && (
                  <div className="flex items-center justify-center gap-2 text-primary text-sm">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    {t("wechat_bridge.qr_scanned")}
                  </div>
                )}
                <button
                  onClick={() => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; setStep("idle"); setQrUrl(null); }}
                  className="text-[11px] text-on-surface-variant hover:text-on-surface uppercase tracking-wider transition-colors"
                >
                  {t("wechat_bridge.qr_cancel")}
                </button>
              </div>
            ) : step === "starting-server" || step === "connecting" ? (
              <div className="text-center space-y-4 py-8">
                <span className="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
                <p className="text-on-surface-variant text-sm">
                  {step === "starting-server" ? t("wechat_bridge.starting_server") : t("wechat_bridge.connecting_bridge")}
                </p>
              </div>
            ) : isReady ? (
              <div className="text-center space-y-5">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-primary">wifi</span>
                </div>
                <h2 className="text-lg font-headline font-bold text-on-surface">{t("wechat_bridge.ready_title")}</h2>
                <p className="text-xs text-on-surface-variant">
                  {t("wechat_bridge.ready_hint")}
                </p>
                <div className="flex items-center justify-center gap-3 text-[11px] text-on-surface-variant">
                  <span>{serverStatus?.thoughts ?? 0} thoughts</span>
                  <span className="text-outline-variant">·</span>
                  <span>{serverStatus?.conversations ?? 0} conversations</span>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button onClick={startConnect} disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-lg text-on-surface-variant hover:text-primary bg-surface-container-high transition-all">
                    <span className="material-symbols-outlined text-[16px]">refresh</span> {t("wechat_bridge.rebind")}
                  </button>
                  <button onClick={handleDisconnect} disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-lg text-error/60 hover:text-error bg-error-container/10 transition-all">
                    {actionLoading ? <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[16px]">power_off</span>}
                    {t("wechat_bridge.disconnect")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-5">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-container-high flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">wifi_off</span>
                </div>
                <h2 className="text-lg font-headline font-bold text-on-surface">{t("wechat_bridge.connect_title")}</h2>
                <p className="text-xs text-on-surface-variant">{t("wechat_bridge.connect_hint")}</p>
                {error && (
                  <div className="text-[11px] text-error bg-error-container/20 rounded-xl px-4 py-3 text-left">{error}</div>
                )}
                {account?.configured && !daemonRunning ? (
                  <div className="space-y-3">
                    <button
                      onClick={handleStartDaemon}
                      disabled={actionLoading}
                      title={t("wechat_bridge.start_bridge_title")}
                      className="inline-flex items-center gap-2 px-8 py-3 text-sm font-bold rounded-xl luminous-pulse text-on-primary disabled:opacity-50 active:scale-95 transition-all"
                    >
                      {actionLoading ? <span className="material-symbols-outlined animate-spin">progress_activity</span> : <span className="material-symbols-outlined">power</span>}
                      {t("wechat_bridge.start_bridge_button")}
                    </button>
                    <div className="text-[11px] text-on-surface-variant/50">
                      {t("wechat_bridge.bound_to", { id: account.accountId?.slice(0, 12) })}
                      <button onClick={startConnect} className="text-primary hover:underline ml-2">{t("wechat_bridge.rebind_link")}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={startConnect}
                      disabled={actionLoading}
                      title={t("wechat_bridge.scan_button_title")}
                      className="inline-flex items-center gap-2 px-8 py-3 text-sm font-bold rounded-xl luminous-pulse text-on-primary disabled:opacity-50 active:scale-95 transition-all"
                    >
                      {actionLoading ? <span className="material-symbols-outlined animate-spin">progress_activity</span> : <span className="material-symbols-outlined">qr_code_scanner</span>}
                      {t("wechat_bridge.scan_button")}
                    </button>
                    <p className="text-[11px] text-on-surface-variant/50 max-w-xs mx-auto leading-relaxed">
                      {t("wechat_bridge.scan_hint")}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Command panel */}
        <div className="col-span-12 lg:col-span-7">
          <div className="bg-surface-container-low p-6 rounded-2xl ghost-border">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-headline font-bold text-on-surface uppercase tracking-widest">
                {t("wechat_bridge.cmd_panel_title")}
              </h3>
              <span className="text-[11px] text-on-surface-variant/40 font-mono">v1.2</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <CmdCard icon="list" cmd={t("wechat_bridge.cmd_send_text")} desc={t("wechat_bridge.cmd_send_text_desc")} />
              <CmdCard icon="image" cmd={t("wechat_bridge.cmd_send_image")} desc={t("wechat_bridge.cmd_send_image_desc")} />
              <CmdCard icon="format_list_numbered" cmd="/list [n]" desc={t("wechat_bridge.cmd_list_desc")} />
              <CmdCard icon="search" cmd={t("wechat_bridge.cmd_search")} desc={t("wechat_bridge.cmd_search_desc")} />
              <CmdCard icon="visibility" cmd="/view <ID>" desc={t("wechat_bridge.cmd_view_desc")} />
              <CmdCard icon="chat_bubble" cmd="/chat <ID>" desc={t("wechat_bridge.cmd_chat_desc")} />
              <CmdCard icon="logout" cmd="/exit" desc={t("wechat_bridge.cmd_exit_desc")} />
              <CmdCard icon="inventory_2" cmd="/archive <ID>" desc={t("wechat_bridge.cmd_archive_desc")} />
              <CmdCard icon="monitoring" cmd="/status" desc={t("wechat_bridge.cmd_status_desc")} />
              <CmdCard icon="help" cmd="/help" desc={t("wechat_bridge.cmd_help_desc")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, label, value, active }: { icon: string; label: string; value: string; active: boolean }) {
  return (
    <div className={`p-4 rounded-xl transition-all ${active ? "bg-primary/10 ghost-border" : "bg-surface-container-low"}`}>
      <span className={`material-symbols-outlined text-[20px] mb-2 block ${active ? "text-primary" : "text-on-surface-variant/40"}`}>{icon}</span>
      <p className="text-[11px] text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold mt-1 ${active ? "text-primary" : "text-on-surface-variant/60"}`}>{value}</p>
    </div>
  );
}

function CmdCard({ icon, cmd, desc }: { icon: string; cmd: string; desc: string }) {
  return (
    <div className="p-4 bg-surface-container-lowest rounded-xl hover:bg-surface-container transition-colors group cursor-default">
      <span className="material-symbols-outlined text-[18px] text-on-surface-variant/40 group-hover:text-primary transition-colors mb-2 block">{icon}</span>
      <code className="text-[11px] text-primary font-mono block mb-1">{cmd}</code>
      <p className="text-[11px] text-on-surface-variant">{desc}</p>
    </div>
  );
}
