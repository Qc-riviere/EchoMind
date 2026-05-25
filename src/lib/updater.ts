import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask, message } from "@tauri-apps/plugin-dialog";

let checking = false;

export async function checkForUpdatesOnStartup(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) return;
    await promptInstall(update);
  } catch (e) {
    console.warn("[updater] check failed:", e);
  } finally {
    checking = false;
  }
}

export async function checkForUpdatesManual(): Promise<void> {
  if (checking) {
    await message("正在检查更新，请稍候…", { title: "EchoMind", kind: "info" });
    return;
  }
  checking = true;
  try {
    const update = await check();
    if (!update) {
      await message("已经是最新版本。", { title: "EchoMind", kind: "info" });
      return;
    }
    await promptInstall(update);
  } catch (e) {
    await message(`检查更新失败：${e}`, { title: "EchoMind", kind: "error" });
  } finally {
    checking = false;
  }
}

async function promptInstall(update: Update): Promise<void> {
  const notes = (update.body ?? "").trim();
  const tail = notes ? `\n\n更新说明：\n${notes.slice(0, 400)}${notes.length > 400 ? "…" : ""}` : "";
  const ok = await ask(
    `发现新版本 v${update.version}（当前 v${update.currentVersion}）。立即下载并安装？${tail}`,
    { title: "EchoMind 更新可用", kind: "info", okLabel: "下载并安装", cancelLabel: "稍后" },
  );
  if (!ok) return;

  try {
    await update.downloadAndInstall();
    // Windows: installer runs passively and the app exits to be replaced;
    // macOS: the app bundle is swapped in place and we relaunch ourselves.
    await relaunch();
  } catch (e) {
    await message(`安装失败：${e}\n\n可手动到 GitHub 下载最新版。`, {
      title: "EchoMind 更新失败",
      kind: "error",
    });
  }
}
