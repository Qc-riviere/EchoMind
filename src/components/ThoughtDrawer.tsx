import { useState, useEffect, useRef } from "react";
import { X, Save, MessageSquare, Archive, Lightbulb, Loader2, Check, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Thought } from "../lib/types";
import { useThoughtStore } from "../stores/thoughtStore";
import { format } from "date-fns";
import ConfirmDialog from "./ConfirmDialog";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  thought: Thought | null;
  onClose: () => void;
}

export default function ThoughtDrawer({ thought, onClose }: Props) {
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [displayThought, setDisplayThought] = useState<Thought | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const updateThought = useThoughtStore((s) => s.updateThought);
  const archiveThought = useThoughtStore((s) => s.archiveThought);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isOpen = !!thought;

  useEffect(() => {
    if (thought) {
      setDisplayThought(thought);
      setContent(thought.content);
      setLastSavedContent(thought.content);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
      }, 50);
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [thought]);

  const handleSave = async (contentToSave: string) => {
    if (!displayThought || contentToSave.trim() === lastSavedContent || !contentToSave.trim()) return;
    setIsSaving(true);
    try {
      await updateThought(displayThought.id, contentToSave.trim());
      setLastSavedContent(contentToSave.trim());
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      handleSave(newContent);
    }, 1500);
  };

  const hasUnsavedChanges = content.trim() !== lastSavedContent && content.trim() !== "";

  const handleClose = async () => {
    if (hasUnsavedChanges) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      await handleSave(content);
    }
    onClose();
  };

  const handleArchive = async () => {
    setShowArchiveConfirm(true);
  };

  const confirmArchive = async () => {
    if (!displayThought) return;
    if (hasUnsavedChanges) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      await handleSave(content);
    }
    archiveThought(displayThought.id);
    setShowArchiveConfirm(false);
    onClose();
  };

  const handleReanalyze = async () => {
    if (!displayThought || isAnalyzing) return;
    
    setIsAnalyzing(true);
    try {
      // First save any unsaved changes
      if (hasUnsavedChanges) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        await handleSave(content);
      }
      
      // Call the enrich_thought command directly to re-analyze
      // Note: enrich_thought already handles embedding internally
      const enriched = await invoke<Thought>("enrich_thought", { thoughtId: displayThought.id });
      
      // Update the displayed thought with new enrichment data
      setDisplayThought(enriched);
      
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (e) {
      console.error("Failed to re-analyze:", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <>
      {/* 归档确认对话框 */}
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="确认归档"
        message="归档后这条灵感将从主列表移除，你可以在归档页面找到它并恢复。"
        confirmText="归档"
        cancelText="取消"
        variant="warning"
        icon="archive"
        onConfirm={confirmArchive}
        onCancel={() => setShowArchiveConfirm(false)}
      />
      
      {/* 透明遮罩层 - 点击关闭 */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/5"
          onClick={handleClose}
        />
      )}
      
      <div 
        className={`
          fixed top-8 lg:top-12 right-8 lg:right-12 h-[calc(100vh-4rem)] lg:h-[calc(100vh-6rem)] z-50
          transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${isOpen 
            ? 'opacity-100 translate-x-0' 
            : 'opacity-0 translate-x-[120%] pointer-events-none'
          }
        `}
        style={{ width: '400px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full h-full bg-white/80 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgba(87,91,140,0.12)] rounded-3xl flex flex-col overflow-hidden">
          
          {/* 头部 */}
          <div className="flex items-center justify-between p-5 border-b border-[#e3e1ed]/50 bg-white/50">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-[#575b8c]" />
              <h2 className="font-semibold text-[#31323b]">编辑灵感</h2>
            </div>
            
            {/* 保存状态指示器 */}
            <div className="flex items-center gap-2">
              {isSaving && (
                <div className="flex items-center gap-1.5 text-xs text-[#575b8c]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>保存中...</span>
                </div>
              )}
              {showSaved && !isSaving && (
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <Check className="w-3.5 h-3.5" />
                  <span>已保存</span>
                </div>
              )}
              {hasUnsavedChanges && !isSaving && (
                <span className="text-xs text-[#a1a1aa]">编辑中</span>
              )}
            </div>
            
            <button 
              onClick={handleClose}
              className="p-2 text-[#7a7a84] hover:text-[#31323b] hover:bg-[#e9e7f1] rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 内容编辑区 */}
          {displayThought && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {displayThought.image_path && (
                <div className="rounded-2xl overflow-hidden border border-[#e3e1ed]/50 shadow-sm">
                  <img
                    src={`http://127.0.0.1:8765/api/images/${displayThought.image_path}`}
                    alt="想法图片"
                    className="w-full max-h-80 object-contain bg-[#f4f0fa]/50"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#7a7a84] mb-2 uppercase tracking-wider">
                  内容
                </label>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    handleContentChange(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  placeholder="写下你的想法..."
                  className="w-full bg-transparent border-none p-0 text-lg text-[#31323b] leading-relaxed resize-none focus:outline-none placeholder-[#a1a1aa]"
                />
              </div>

              {/* AI 解析结果区 */}
              {displayThought.context && (
                <div className="bg-gradient-to-br from-[#f4f0fa] to-white rounded-2xl p-4 border border-[#e3e1ed]/50 shadow-sm">
                  <label className="block text-xs font-medium text-[#575b8c] mb-2 uppercase tracking-wider">
                    AI 洞察
                  </label>
                  <p className="text-sm text-[#5e5e68] leading-relaxed">
                    {displayThought.context}
                  </p>
                </div>
              )}

              {/* 元数据 */}
              <div className="space-y-3 pt-4 border-t border-[#e3e1ed]/50">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-[#a1a1aa]">创建时间</span>
                  <span className="text-[#5e5e68] font-medium">{format(new Date(displayThought.created_at), "yyyy-MM-dd HH:mm")}</span>
                </div>
                {displayThought.domain && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#a1a1aa]">领域</span>
                    <span className="px-2.5 py-1 rounded-full bg-[#f6d0fd]/40 text-[#855392] text-xs font-medium border border-[#f6d0fd]/50">
                      {displayThought.domain}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 底部操作栏 */}
          {displayThought && (
            <div className="p-5 border-t border-[#e3e1ed]/50 bg-white/50">
              {/* 分析状态指示器 */}
              {isAnalyzing && (
                <div className="flex items-center gap-2 mb-3 text-xs text-[#575b8c] bg-[#c1c5fd]/10 rounded-xl px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>AI 正在重新分析...</span>
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={handleReanalyze}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-[#575b8c] bg-[#c1c5fd]/20 hover:bg-[#c1c5fd]/30 disabled:opacity-50 transition-colors"
                    title="重新让 AI 分析这条灵感"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    再分析
                  </button>
                  <button
                    onClick={() => navigate(`/thought/${displayThought.id}/chat`)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-[#575b8c] bg-[#c1c5fd]/20 hover:bg-[#c1c5fd]/30 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    拷问
                  </button>
                  <button
                    onClick={handleArchive}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-[#a8364b] bg-[#f97386]/10 hover:bg-[#f97386]/20 transition-colors"
                  >
                    <Archive className="w-4 h-4" />
                    归档
                  </button>
                </div>

                <button
                  onClick={() => {
                    if (saveTimeoutRef.current) {
                      clearTimeout(saveTimeoutRef.current);
                    }
                    handleSave(content);
                  }}
                  disabled={!hasUnsavedChanges || isSaving}
                  className="flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-xl text-white bg-[#575b8c] hover:bg-[#434670] disabled:opacity-50 disabled:hover:bg-[#575b8c] transition-all shadow-md shadow-[#575b8c]/20"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
