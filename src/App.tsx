import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "./components/MainLayout";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import ChatHubPage from "./pages/ChatHubPage";
import ArchivePage from "./pages/ArchivePage";
import WeChatBridgePage from "./pages/WeChatBridgePage";
import CloudBridgePage from "./pages/CloudBridgePage";
import GraphPage from "./pages/GraphPage";
import Onboarding from "./components/Onboarding";
import { useSettingStore } from "./stores/settingStore";
import "./App.css";

function OnboardingGate() {
  const { settings, fetchSettings, loading } = useSettingStore();
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchSettings().finally(() => setHydrated(true));
  }, [fetchSettings]);

  useEffect(() => {
    if (!hydrated) return;
    const completed = settings["onboarding_completed"] === "1";
    const dismissed = settings["onboarding_dismissed"] === "1";
    const hasKey = !!settings["llm_api_key"];
    if (!completed && !dismissed && !hasKey) setOpen(true);
  }, [hydrated, settings]);

  if (!hydrated || loading || !open) return null;
  return <Onboarding onClose={() => setOpen(false)} />;
}

function App() {
  return (
    <BrowserRouter>
      <OnboardingGate />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/chat" element={<ChatHubPage />} />
          <Route path="/thought/:thoughtId/chat" element={<ChatHubPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/wechat" element={<WeChatBridgePage />} />
          <Route path="/cloud" element={<CloudBridgePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
