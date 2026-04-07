import { NavLink } from "react-router-dom";
import { Home, Search, Settings, Brain, Archive, MessageSquare } from "lucide-react";

const navItems = [
  { to: "/", icon: Home, label: "首页", shortcut: "Ctrl+N" },
  { to: "/search", icon: Search, label: "搜索", shortcut: "Ctrl+K" },
  { to: "/archive", icon: Archive, label: "归档" },
  { to: "/wechat", icon: MessageSquare, label: "微信桥接" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export default function Sidebar() {
  return (
    <aside className="w-20 bg-white/40 backdrop-blur-xl flex flex-col items-center py-6 gap-4 border-r border-white/60 shadow-[4px_0_24px_rgba(87,91,140,0.03)] z-10">
      <div className="mb-6 p-3 bg-gradient-to-br from-white to-white/50 rounded-2xl shadow-sm border border-white/80">
        <Brain className="w-8 h-8 text-[#575b8c]" />
      </div>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-300 ${
              isActive
                ? "bg-[#575b8c] text-white shadow-lg shadow-[#575b8c]/25 scale-105"
                : "text-[#7a7a84] hover:text-[#575b8c] hover:bg-white/60 hover:scale-105"
            }`
          }
          title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
        >
          <item.icon className="w-5 h-5" />
        </NavLink>
      ))}
    </aside>
  );
}
