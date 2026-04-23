import { create } from "zustand";

type Theme = "dark" | "light" | "system";

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export const useThemeStore = create<ThemeStore>((set) => {
  const saved = (localStorage.getItem("echomind-theme") as Theme) || "dark";
  // Apply on load
  applyTheme(saved);

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = useThemeStore.getState().theme;
    if (current === "system") applyTheme("system");
  });

  return {
    theme: saved,
    setTheme: (theme: Theme) => {
      localStorage.setItem("echomind-theme", theme);
      applyTheme(theme);
      set({ theme });
    },
  };
});
