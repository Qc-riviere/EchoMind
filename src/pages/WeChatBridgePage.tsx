import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  MessageSquare,
  Server,
  Power,
  PowerOff,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Smartphone,
  Terminal,
  Copy,
  Check,
} from "lucide-react";

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

export default function WeChatBridgePage() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [account, setAccount] = useState<WeChatAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [status, acct] = await Promise.all([
        invoke<ServerStatus>("bridge_server_status"),
        invoke<WeChatAccount>("bridge_wechat_account"),
      ]);
      setServerStatus(status);
      setAccount(acct);
    } catch (e) {
      console.error("Failed to fetch bridge status:", e);
      setServerStatus({ online: false });
      setAccount({ configured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleStartServer = async () => {
    setStarting(true);
    try {
      await invoke("bridge_start_server");
      // Wait a moment for server to bind
      await new Promise((r) => setTimeout(r, 2000));
      await refresh();
    } catch (e) {
      console.error("Failed to start server:", e);
    } finally {
      setStarting(false);
    }
  };

  const handleStopServer = async () => {
    setStopping(true);
    try {
      await invoke("bridge_stop_server");
      await new Promise((r) => setTimeout(r, 500));
      await refresh();
    } catch (e) {
      console.error("Failed to stop server:", e);
    } finally {
      setStopping(false);
    }
  };

  const copyCommand = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-[#575b8c] animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div className="flex justify-center w-full">
        <div className="w-full max-w-3xl">
          <div className="space-y-6 py-8">
            {/* Header */}
            <div className="pt-4">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#575b8c] to-[#8a8dc4] font-[Manrope] tracking-tight">
                微信桥接
              </h1>
              <p className="text-[#7a7a84] mt-2 font-medium">
                通过微信随时记录想法、搜索和 AI 对话
              </p>
            </div>

            {/* Architecture Diagram */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-5 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center border border-green-200/50">
                    <Smartphone className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-[#7a7a84] text-xs">微信</span>
                </div>
                <div className="text-[#c4c4cc] text-xs flex-shrink-0">
                  ← ilink API →
                </div>
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-200/50">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-[#7a7a84] text-xs">桥接守护</span>
                </div>
                <div className="text-[#c4c4cc] text-xs flex-shrink-0">
                  ← HTTP →
                </div>
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center border border-purple-200/50">
                    <Server className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-[#7a7a84] text-xs">API Server</span>
                </div>
                <div className="text-[#c4c4cc] text-xs flex-shrink-0">
                  ← SQLite →
                </div>
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-[#f4f0fa] flex items-center justify-center border border-[#e3e1ed]/50">
                    <svg className="w-5 h-5 text-[#575b8c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  </div>
                  <span className="text-[#7a7a84] text-xs">桌面应用</span>
                </div>
              </div>
            </div>

            {/* API Server Card */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-[#3a3e6c] flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  API Server
                </h2>
                <button
                  onClick={refresh}
                  className="p-2 rounded-xl text-[#7a7a84] hover:text-[#575b8c] hover:bg-white/60 transition-all"
                  title="刷新状态"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center gap-3">
                {serverStatus?.online ? (
                  <>
                    <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50/80 rounded-2xl px-4 py-2.5 border border-emerald-200/50 flex-1">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span className="font-medium">在线</span>
                      <span className="text-emerald-500 ml-2">
                        {serverStatus.thoughts} 想法 · {serverStatus.conversations} 对话
                      </span>
                    </div>
                    <button
                      onClick={handleStopServer}
                      disabled={stopping}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-all border border-red-200/50 disabled:opacity-50"
                    >
                      {stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                      停止
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm text-[#a8364b] bg-[#f97386]/10 rounded-2xl px-4 py-2.5 border border-[#f97386]/20 flex-1">
                      <XCircle className="w-4 h-4 shrink-0" />
                      <span className="font-medium">离线</span>
                      <span className="text-[#c4636f] ml-2">127.0.0.1:8765</span>
                    </div>
                    <button
                      onClick={handleStartServer}
                      disabled={starting}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#575b8c] text-white hover:bg-[#434670] transition-all shadow-sm disabled:opacity-50"
                    >
                      {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                      启动
                    </button>
                  </>
                )}
              </div>

              {/* Manual start hint */}
              {!serverStatus?.online && (
                <div className="text-xs text-[#7a7a84] bg-[#f8f8fa] rounded-xl px-4 py-3 border border-[#e3e1ed]/30">
                  也可以手动启动：
                  <CommandBlock
                    cmd="cd src-tauri
cargo run -p echomind-server"
                    id="server"
                    copied={copied}
                    onCopy={copyCommand}
                  />
                </div>
              )}
            </div>

            {/* WeChat Account Card */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-4">
              <h2 className="text-lg font-bold text-[#3a3e6c] flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                微信账号
              </h2>

              {account?.configured ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50/80 rounded-2xl px-4 py-2.5 border border-emerald-200/50">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">已绑定</span>
                  <span className="text-emerald-500 ml-2">
                    ID: {account.accountId}
                  </span>
                  {account.createdAt && (
                    <span className="text-emerald-400 ml-auto text-xs">
                      {new Date(account.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50/80 rounded-2xl px-4 py-2.5 border border-amber-200/50">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">未绑定</span>
                </div>
              )}

              {/* Setup instructions */}
              <div className="text-xs text-[#7a7a84] bg-[#f8f8fa] rounded-xl px-4 py-3 border border-[#e3e1ed]/30 space-y-2">
                <p className="font-medium text-[#575b8c]">
                  {account?.configured ? "重新绑定微信：" : "绑定微信（首次设置）："}
                </p>
                <CommandBlock
                  cmd="cd echomind-wechat
npm install
npm run build
npm run setup"
                  id="setup"
                  copied={copied}
                  onCopy={copyCommand}
                />
              </div>
            </div>

            {/* Bridge Daemon Card */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-4">
              <h2 className="text-lg font-bold text-[#3a3e6c] flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                桥接守护进程
              </h2>

              <div className="text-sm text-[#5e5e68] space-y-2">
                <p>
                  守护进程连接微信和 API Server，需要在终端中单独运行。
                </p>

                {/* Prerequisites */}
                <div className="flex gap-2 flex-wrap mt-3">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${
                      serverStatus?.online
                        ? "bg-emerald-50 text-emerald-600 border-emerald-200/50"
                        : "bg-red-50 text-red-500 border-red-200/50"
                    }`}
                  >
                    {serverStatus?.online ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    API Server
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${
                      account?.configured
                        ? "bg-emerald-50 text-emerald-600 border-emerald-200/50"
                        : "bg-amber-50 text-amber-600 border-amber-200/50"
                    }`}
                  >
                    {account?.configured ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    微信账号
                  </span>
                </div>
              </div>

              <div className="text-xs text-[#7a7a84] bg-[#f8f8fa] rounded-xl px-4 py-3 border border-[#e3e1ed]/30 space-y-2">
                <p className="font-medium text-[#575b8c]">启动桥接：</p>
                <CommandBlock
                  cmd="cd echomind-wechat
npm start"
                  id="daemon"
                  copied={copied}
                  onCopy={copyCommand}
                />
              </div>
            </div>

            {/* WeChat Commands Reference */}
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl p-6 shadow-[0_4px_16px_rgba(87,91,140,0.04)] border border-white/60 space-y-4">
              <h2 className="text-lg font-bold text-[#3a3e6c]">微信端命令</h2>
              <div className="text-sm space-y-0.5">
                <CmdRow cmd="直接发文字" desc="快速记录想法" />
                <CmdRow cmd="/list [n]" desc="列出最近 n 条想法" />
                <CmdRow cmd="/search <关键词>" desc="语义搜索想法" />
                <CmdRow cmd="/view <ID>" desc="查看想法详情" />
                <CmdRow cmd="/chat <ID>" desc="开始 AI 深度对话" />
                <CmdRow cmd="/exit" desc="退出对话模式" />
                <CmdRow cmd="/archive <ID>" desc="归档想法" />
                <CmdRow cmd="/status" desc="系统状态" />
                <CmdRow cmd="/help" desc="显示帮助" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CmdRow({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-[#f4f0fa]/50 transition-colors">
      <code className="text-[#575b8c] font-mono text-xs bg-[#f4f0fa] px-2 py-1 rounded-lg">
        {cmd}
      </code>
      <span className="text-[#7a7a84] text-xs">{desc}</span>
    </div>
  );
}

function CommandBlock({
  cmd,
  id,
  copied,
  onCopy,
}: {
  cmd: string;
  id: string;
  copied: string | null;
  onCopy: (cmd: string, id: string) => void;
}) {
  const lines = cmd.split("\n").filter(Boolean);
  return (
    <div className="flex items-start gap-2 bg-[#1e1e2e] text-[#cdd6f4] rounded-lg px-3 py-2 font-mono text-xs mt-1">
      <div className="flex-1 select-all">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-green-400 select-none">&gt;</span>
            <code>{line}</code>
          </div>
        ))}
      </div>
      <button
        onClick={() => onCopy(cmd, id)}
        className="shrink-0 text-[#7a7a84] hover:text-white transition-colors p-1 mt-0.5"
        title="复制"
      >
        {copied === id ? (
          <Check className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
