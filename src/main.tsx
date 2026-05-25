import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CaptureWindow from "./pages/CaptureWindow";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { checkForUpdatesOnStartup } from "./lib/updater";

const isCapture = new URLSearchParams(window.location.search).get("capture") === "1";

if (!isCapture) {
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
