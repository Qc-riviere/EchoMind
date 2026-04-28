import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

// Request notification permission once on app boot. The actual emit happens
// on demand via lib/notify.ts.
isPermissionGranted()
  .then((granted) => (granted ? Promise.resolve("granted") : requestPermission()))
  .catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
