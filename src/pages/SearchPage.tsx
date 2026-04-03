import { Search, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Thought } from "../lib/types";
import ThoughtCard from "../components/ThoughtCard";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Thought[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;

    setSearching(true);
    setError(null);
    try {
      const found = await invoke<Thought[]>("semantic_search", { query: q });
      setResults(found);
      setSearched(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div className="flex justify-center w-full">
        <div className="w-full max-w-3xl">
          <div className="space-y-8 py-8">
            <div className="pt-4">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#575b8c] to-[#8a8dc4] font-[Manrope] tracking-tight">
                语义搜索
              </h1>
              <p className="text-[#7a7a84] mt-2 font-medium">
                用自然语言描述，AI 会找到语义相关的想法
              </p>
            </div>

            {/* 搜索输入框 */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#c1c5fd] to-[#575b8c] rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-500"></div>
              <div className="relative flex items-center bg-white/90 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 focus-within:ring-2 focus-within:ring-[#575b8c]/20 transition-all duration-300">
                <Search className="w-5 h-5 text-[#a1a1aa] ml-5 shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="描述你想找的内容... (Ctrl+K)"
                  className="flex-1 bg-transparent px-4 py-4 text-lg text-[#31323b] placeholder-[#a1a1aa] focus:outline-none transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  disabled={searching}
                />
                {searching && (
                  <Loader2 className="w-5 h-5 text-[#575b8c] animate-spin mr-5" />
                )}
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="text-sm text-[#a8364b] bg-[#f97386]/10 rounded-2xl p-4 border border-[#f97386]/20">
                {error}
              </div>
            )}

            {/* 搜索结果 */}
            {results.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-[#7a7a84] font-medium">
                  找到 {results.length} 条相关想法
                </p>
                {results.map((thought) => (
                  <ThoughtCard key={thought.id} thought={thought} />
                ))}
              </div>
            )}

            {/* 无结果 */}
            {searched && results.length === 0 && !error && (
              <div className="text-center py-20 space-y-4 bg-white/40 backdrop-blur-sm rounded-3xl border border-white/60 shadow-sm">
                <Search className="w-16 h-16 mx-auto text-[#c1c5fd] drop-shadow-md" />
                <div>
                  <p className="text-lg font-medium text-[#575b8c]">没有找到相关想法</p>
                  <p className="text-[#a1a1aa] mt-1">试试其他关键词，或记录更多想法</p>
                </div>
              </div>
            )}

            {/* 初始状态 */}
            {!searched && !error && (
              <div className="text-center py-20 space-y-4 bg-white/40 backdrop-blur-sm rounded-3xl border border-white/60 shadow-sm">
                <div className="relative">
                  <Sparkles className="w-16 h-16 mx-auto text-[#c1c5fd] drop-shadow-md" />
                </div>
                <div>
                  <p className="text-lg font-medium text-[#575b8c]">AI 语义搜索</p>
                  <p className="text-[#a1a1aa] mt-1">
                    输入描述后按回车，AI 会理解语义找到相关内容
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
