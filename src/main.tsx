import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CaptureWindow from "./pages/CaptureWindow";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const isCapture = new URLSearchParams(window.location.search).get("capture") === "1";

if (!isCapture) {
  // Request notification permission once on app boot. The actual emit happens
  // on demand via lib/notify.ts.
  isPermissionGranted()
    .then((granted) => (granted ? Promise.resolve("granted") : requestPermission()))
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCapture ? <CaptureWindow /> : <App />}
  </React.StrictMode>,
);
