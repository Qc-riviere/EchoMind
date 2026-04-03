import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

export default function MainLayout() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-screen bg-gradient-to-br from-[#fbf8fe] to-[#f4f0fa] text-[#31323b] overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 lg:p-12">
        <Outlet />
      </main>
    </div>
  );
}
