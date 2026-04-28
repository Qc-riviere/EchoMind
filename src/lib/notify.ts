import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionState: "unknown" | "granted" | "denied" = "unknown";

async function ensurePermission(): Promise<boolean> {
  if (permissionState === "granted") return true;
  if (permissionState === "denied") return false;
  try {
    const granted = await isPermissionGranted();
    if (granted) {
      permissionState = "granted";
      return true;
    }
    const next = await requestPermission();
    if (next === "granted") {
      permissionState = "granted";
      return true;
    }
    permissionState = "denied";
    return false;
  } catch {
    permissionState = "denied";
    return false;
  }
}

/**
 * Best-effort system toast. Silently no-ops if the plugin can't reach
 * the OS (web preview, denied permission, missing capability).
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* swallow */
  }
}
