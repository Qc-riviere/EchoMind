import { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { useThoughtStore } from "../stores/thoughtStore";
import RelatedThoughtsHint from "./RelatedThoughtsHint";

export default function ThoughtInput() {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [recentThoughtId, setRecentThoughtId] = useState<string | null>(null);
  const addThought = useThoughtStore((s) => s.addThought);
  const enrichAndEmbed = useThoughtStore((s) => s.enrichAndEmbed);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || saving) return;

    setSaving(true);
    try {
      const thought = await addThought(text);
      setInput("");
      setRecentThoughtId(thought.id);
      enrichAndEmbed(thought.id);
    } catch (e) {
      console.error("Failed to save thought:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDismissHint = () => {
    setRecentThoughtId(null);
  };

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-[#c1c5fd] to-[#575b8c] rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-500"></div>
      <div className="relative flex gap-3 bg-white/90 backdrop-blur-md rounded-2xl p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 focus-within:ring-2 focus-within:ring-[#575b8c]/20 transition-all duration-300">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="记下一个想法... (Ctrl+N)"
          className="flex-1 bg-transparent px-4 py-3 text-lg text-[#31323b] placeholder-[#a1a1aa] focus:outline-none transition-colors"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          disabled={saving}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || saving}
          className="bg-[#575b8c] hover:bg-[#434670] disabled:opacity-50 disabled:hover:bg-[#575b8c] text-white px-5 py-3 rounded-xl transition-all duration-200 active:scale-95 shadow-md shadow-[#575b8c]/20 flex items-center gap-2 font-medium"
        >
          <Plus className="w-5 h-5" />
          <span>保存</span>
        </button>
      </div>
      {recentThoughtId && (
        <RelatedThoughtsHint
          thoughtId={recentThoughtId}
          onDismiss={handleDismissHint}
        />
      )}
    </div>
  );
}
