import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, Sparkles } from "lucide-react";
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
    <div className="bg-gradient-to-br from-[#575b8c]/5 to-[#c1c5fd]/10 border border-[#c1c5fd]/30 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-[#575b8c]" />
        <h3 className="font-semibold text-[#3a3e6c]">Enable AI Features</h3>
      </div>
      <p className="text-sm text-[#5e5e68] leading-relaxed">
        Configure your API Key to unlock AI-powered context generation, semantic search, and interrogation dialogues.
        Without it, you can still record thoughts — AI features will activate once configured.
      </p>
      <button
        onClick={() => navigate("/settings")}
        className="flex items-center gap-2 text-sm font-medium text-[#575b8c] hover:text-[#3a3e6c] transition-colors"
      >
        <Settings className="w-4 h-4" />
        Go to Settings
      </button>
    </div>
  );
}
