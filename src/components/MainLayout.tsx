import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import "../stores/themeStore"; // Initialize theme on load

const BREADCRUMB_MAP: Record<string, string> = {
  "/": "Dashboard",
  "/search": "Search",
  "/archive": "Archive",
  "/chat": "Deep Questioning",
  "/settings": "System Architecture",
  "/wechat": "Infrastructure",
};

export default function MainLayout() {
  useKeyboardShortcuts();
  const location = useLocation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const breadcrumb = BREADCRUMB_MAP[location.pathname] || "";

  return (
    <div className={`flex flex-col h-screen bg-surface text-on-surface overflow-hidden ${isMaximized ? "" : "rounded-xl"}`}>
      {/* Custom title bar */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top App Bar */}
          <header className="flex justify-between items-center w-full px-8 py-3 shrink-0 bg-surface">
            <div className="flex items-center gap-4">
              <span className="hidden md:block text-lg font-semibold text-primary font-headline">ECHOMIND</span>
              {breadcrumb && (
                <>
                  <div className="h-5 w-px bg-outline-variant/30" />
                  <span className="text-sm text-on-surface-variant uppercase tracking-widest font-headline">{breadcrumb}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="relative flex items-center bg-surface-container-low px-4 py-1.5 rounded-full ghost-border">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">search</span>
                <input
                  className="bg-transparent border-none focus:ring-0 focus:outline-none text-[10px] text-on-surface w-48 placeholder:text-on-surface-variant/40 ml-2 uppercase tracking-widest"
                  placeholder="CMD + K TO SEARCH"
                  type="text"
                  readOnly
                />
              </div>
              <div className="flex items-center gap-4 text-on-surface-variant/60">
                <button className="hover:text-on-surface transition-colors relative">
                  <span className="material-symbols-outlined">notifications</span>
                </button>
                <button className="hover:text-on-surface transition-colors">
                  <span className="material-symbols-outlined">account_circle</span>
                </button>
              </div>
            </div>
          </header>
          {/* Main content */}
          <div className="flex-1 overflow-auto relative">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
