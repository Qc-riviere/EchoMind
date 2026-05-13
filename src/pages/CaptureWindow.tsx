import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function CaptureWindow() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Window is reused (visible:false instead of destroyed), so refocus + reset
    // every time it's shown again via the global hotkey.
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setText("");
        setError(null);
        setSaving(false);
        // RAF to ensure DOM updated before focusing
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = async () => {
    try {
      await getCurrentWindow().hide();
    } catch { /* ignore */ }
    setText("");
    setError(null);
    setSaving(false);
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("create_thought", { content });
      await dismiss();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="h-screen w-screen p-3 bg-transparent">
      <div
        className="h-full w-full rounded-2xl bg-surface-container shadow-2xl border border-outline-variant/20 flex flex-col overflow-hidden"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-outline-variant/10" data-tauri-drag-region>
          <span className="material-symbols-outlined text-primary text-[18px]">bolt</span>
          <span className="text-xs font-headline font-bold text-primary uppercase tracking-[0.2em]">速记</span>
          <span className="ml-auto text-[10px] text-on-surface-variant/50 font-mono">Enter 保存 · Esc 关闭</span>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="一句话灵感…"
          disabled={saving}
          className="flex-1 bg-transparent text-on-surface placeholder:text-on-surface-variant/40 resize-none outline-none border-none px-4 py-3 text-sm leading-relaxed"
        />
        {error && (
          <div className="px-4 py-1.5 text-[11px] text-error bg-error-container/20 truncate">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
