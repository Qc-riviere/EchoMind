import React from "react";
import ReactDOM from "react-dom/client";
// Bundle the Material Symbols icon font locally instead of fetching it from the
// Google Fonts CDN. A desktop app launched at boot (autostart) has no network
// yet, so a CDN font fails and every icon falls back to its raw ligature name
// (home / search / push_pin …). Imported here in the shared entry so both the
// main and capture windows get it. Provides @font-face + .material-symbols-outlined.
import "material-symbols/outlined.css";
import App from "./App";
import CaptureWindow from "./pages/CaptureWindow";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { checkForUpdatesOnStartup } from "./lib/updater";
// Bootstraps i18next from localStorage so the first paint has the right
// language. SettingsPage syncs the SQLite-persisted value back into
// localStorage on save, so a fresh install / wipe falls back to the
// SQLite-stored locale on the next boot.
import "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { setLocale, SUPPORTED_LOCALES, type Locale } from "./i18n";

const isCapture = new URLSearchParams(window.location.search).get("capture") === "1";

if (!isCapture) {
  // Reconcile the i18n locale with the SQLite-persisted setting once boot
  // settles. localStorage already gave us the right one for first paint; this
  // closes the gap when settings was changed on a different install or wiped.
  invoke<string | null>("get_setting", { key: "ui_locale" })
    .then((val) => {
      if (val && (SUPPORTED_LOCALES as readonly string[]).includes(val)) {
        setLocale(val as Locale);
      }
    })
    .catch(() => {});

  // Request notification permission once on app boot. The actual emit happens
  // on demand via lib/notify.ts.
  isPermissionGranted()
    .then((granted) => (granted ? Promise.resolve("granted") : requestPermission()))
    .catch(() => {});

  // Delay the update check so it doesn't compete with first-paint or splash.
  // Failures are silent — we don't want a network blip to nag every launch.
  window.setTimeout(() => {
    checkForUpdatesOnStartup().catch(() => {});
  }, 8000);
}

function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  if (isCapture) {
    splash.remove();
    return;
  }
  // Push the CSS-animated bar to 100% so the transition reads as "done loading",
  // then fade out and remove. Two RAFs ensure the React tree has actually painted
  // before we start the exit transition.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fill = splash.querySelector<HTMLDivElement>(".fill");
      if (fill) {
        fill.style.animation = "none";
        fill.style.transition = "width 220ms ease-out";
        fill.style.width = "100%";
      }
      window.setTimeout(() => {
        splash.classList.add("done");
        window.setTimeout(() => splash.remove(), 280);
      }, 180);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCapture ? <CaptureWindow /> : <App />}
  </React.StrictMode>,
);

dismissSplash();
