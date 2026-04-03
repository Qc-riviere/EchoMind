import { useState } from "react";
import ThoughtInput from "../components/ThoughtInput";
import ThoughtList from "../components/ThoughtList";
import ApiKeyGuide from "../components/ApiKeyGuide";
import ThoughtDrawer from "../components/ThoughtDrawer";
import type { Thought } from "../lib/types";

export default function HomePage() {
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div 
        className="flex justify-center transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ 
          width: selectedThought ? 'calc(100% - 432px)' : '100%' 
        }}
      >
        <div 
          className="w-full transition-[max-width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            maxWidth: selectedThought ? '36rem' : '48rem'
          }}
        >
          <div className="space-y-8 py-8">
            <div className="pt-4">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#575b8c] to-[#8a8dc4] font-[Manrope] tracking-tight">
                EchoMind
              </h1>
              <p className="text-[#7a7a84] mt-2 font-medium">
                记录你的灵感，AI 帮你想透它们。
              </p>
            </div>

            <ApiKeyGuide />
            <ThoughtInput />
            <ThoughtList onThoughtClick={(thought) => setSelectedThought(thought)} activeThoughtId={selectedThought?.id} />
          </div>
        </div>
      </div>

      <ThoughtDrawer 
        thought={selectedThought} 
        onClose={() => setSelectedThought(null)} 
      />
    </div>
  );
}
