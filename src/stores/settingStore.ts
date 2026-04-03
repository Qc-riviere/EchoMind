import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface SettingStore {
  settings: Record<string, string>;
  loading: boolean;
  fetchSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  deleteSetting: (key: string) => Promise<void>;
  getSetting: (key: string) => string | undefined;
}

export const useSettingStore = create<SettingStore>((set, get) => ({
  settings: {},
  loading: false,

  fetchSettings: async () => {
    set({ loading: true });
    try {
      const pairs = await invoke<[string, string][]>("get_all_settings");
      const settings: Record<string, string> = {};
      for (const [key, value] of pairs) {
        settings[key] = value;
      }
      set({ settings, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setSetting: async (key: string, value: string) => {
    await invoke("set_setting", { key, value });
    set({ settings: { ...get().settings, [key]: value } });
  },

  deleteSetting: async (key: string) => {
    await invoke("delete_setting", { key });
    const { [key]: _, ...rest } = get().settings;
    set({ settings: rest });
  },

  getSetting: (key: string) => {
    return get().settings[key];
  },
}));
