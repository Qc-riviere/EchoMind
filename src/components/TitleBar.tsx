import { getCurrentWindow } from "@tauri-apps/api/window";

export default function TitleBar() {
  const handleMinimize = () => getCurrentWindow().minimize();
  const handleToggleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 shrink-0 bg-surface select-none px-4"
    >
      {/* Left: app icon + title */}
      <div data-tauri-drag-region className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="w-4 h-4 pointer-events-none" />
        <span className="text-[11px] text-on-surface-variant/60 font-headline tracking-wider">
          EchoMind
        </span>
      </div>

      {/* Right: window controls */}
      <div className="flex items-center -mr-2">
        <button
          onClick={handleMinimize}
          className="w-10 h-9 flex items-center justify-center text-on-surface-variant/50 hover:bg-surface-container-high hover:text-on-surface transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="w-10 h-9 flex items-center justify-center text-on-surface-variant/50 hover:bg-surface-container-high hover:text-on-surface transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button
          onClick={handleClose}
          className="w-10 h-9 flex items-center justify-center text-on-surface-variant/50 hover:bg-error hover:text-on-error transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
