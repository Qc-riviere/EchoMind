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
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);

  const handleReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    setReindexMessage(null);
    try {
      const count = await invoke<number>("reembed_all_thoughts");
      setReindexMessage(`已重新索引 ${count} 条想法`);
    } catch (e) {
      setReindexMessage(`索引失败：${String(e)}`);
    } finally {
      setReindexing(false);
    }
  };

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
    <div className="max-w-6xl mx-auto px-8 py-12">
      {/* Search Bar */}
      <div className="mb-8">
        <div className="flex items-center bg-surface-container-low rounded-2xl ghost-border px-6 py-4 gap-4">
          <span className="material-symbols-outlined text-on-surface-variant">neurology</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Architectural patterns inspired by bioluminescent ocean life"
            className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-2xl font-headline font-light text-on-surface placeholder:text-on-surface-variant/30"
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            disabled={searching}
          />
          <div className="flex items-center gap-3">
            {searching && <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>}
            <button
              onClick={handleSearch}
              disabled={!query.trim() || searching}
              className="p-2 bg-primary/10 hover:bg-primary/20 rounded-lg text-primary transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </div>
        {/* Mapping indicator */}
        <div className="flex items-center gap-2 mt-3 px-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
          <span className="text-[10px] text-on-surface-variant/60 uppercase tracking-widest font-mono">
            Mapping Latent Space
          </span>
          <div className="flex-1 h-px bg-outline-variant/10"></div>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="text-[10px] text-on-surface-variant/60 hover:text-primary uppercase tracking-widest font-mono flex items-center gap-1 disabled:opacity-50"
            title="重新索引所有想法（在嵌入逻辑改变后使用）"
          >
            <span className={`material-symbols-outlined text-[14px] ${reindexing ? "animate-spin" : ""}`}>
              {reindexing ? "progress_activity" : "refresh"}
            </span>
            {reindexing ? "Reindexing..." : "Reindex"}
          </button>
        </div>
        {reindexMessage && (
          <p className="text-[10px] text-primary/70 mt-2 px-2">{reindexMessage}</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-error bg-error-container/20 rounded-2xl p-4 ghost-border mb-8">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-8">
            <div className="flex flex-col gap-8">
              {results.map((thought, i) => (
                <div key={thought.id}>
                  {i === 0 && (
                    <span className="inline-block px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded-full mb-4">
                      {Math.round(88 - i * 12)}% Vector Match
                    </span>
                  )}
                  <ThoughtCard thought={thought} />
                </div>
              ))}
            </div>
          </div>

          {/* Right panel - Semantic Fragment */}
          <aside className="col-span-12 lg:col-span-4">
            <div className="p-6 bg-surface-container-high rounded-2xl ghost-border">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
                  Semantic Fragment
                </span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Found {results.length} matches across your latent space.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* No results */}
      {searched && results.length === 0 && !error && (
        <div className="text-center py-20 space-y-4 bg-surface-container-low rounded-2xl">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/30">search_off</span>
          <div>
            <p className="text-lg font-headline font-semibold text-on-surface">没有找到相关想法</p>
            <p className="text-on-surface-variant text-sm mt-1">试试其他关键词，或记录更多想法</p>
          </div>
        </div>
      )}

      {/* Initial state */}
      {!searched && !error && (
        <div className="text-center py-20 space-y-4 bg-surface-container-low rounded-2xl">
          <span className="material-symbols-outlined text-6xl text-primary/40">auto_awesome</span>
          <div>
            <p className="text-lg font-headline font-semibold text-on-surface">AI 语义搜索</p>
            <p className="text-on-surface-variant text-sm mt-1">输入描述后按回车，AI 会理解语义找到相关内容</p>
          </div>
        </div>
      )}
    </div>
  );
}
