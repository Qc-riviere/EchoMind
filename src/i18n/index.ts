import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type Locale = "zh" | "en";
export const SUPPORTED_LOCALES: Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";

// Persist on the same SQLite settings table everything else uses, but mirror
// to localStorage so the very first paint after a relaunch can pick the
// correct locale before the React tree mounts and the Tauri command resolves.
const LS_KEY = "echomind:locale";

function readInitialLocale(): Locale {
  try {
    const fromLs = localStorage.getItem(LS_KEY);
    if (fromLs === "zh" || fromLs === "en") return fromLs;
  } catch {
    /* localStorage unavailable — fall back to default */
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: readInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * Set the active UI locale. Updates i18next, localStorage (for next boot
 * pre-mount paint) and `<html lang>`. Caller is responsible for also writing
 * to the SQLite settings table so it survives a localStorage wipe.
 */
export function setLocale(loc: Locale): void {
  if (i18n.language === loc) return;
  void i18n.changeLanguage(loc);
  try {
    localStorage.setItem(LS_KEY, loc);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = loc === "zh" ? "zh-CN" : "en";
  }
}

export default i18n;
