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
import "./App.css";

function App() {
  return (
    <BrowserRouter>
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
