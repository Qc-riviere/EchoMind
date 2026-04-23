import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingStore } from "../stores/settingStore";

export default function ApiKeyGuide() {
  const { settings, fetchSettings } = useSettingStore();
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSettings().then(() => setLoaded(true));
  }, [fetchSettings]);

  if (!loaded || settings["llm_api_key"]) return null;

  return (
    <div className="bg-primary/5 ghost-border rounded-2xl p-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-primary">auto_awesome</span>
        <h3 className="font-headline font-semibold text-on-surface text-sm">Enable AI Features</h3>
      </div>
      <p className="text-sm text-on-surface-variant leading-relaxed">
        Configure your API Key to unlock AI-powered context generation, semantic search, and interrogation dialogues.
        Without it, you can still record thoughts — AI features will activate once configured.
      </p>
      <button
        onClick={() => navigate("/settings")}
        className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">settings</span>
        Go to Settings
      </button>
    </div>
  );
}
