import { useState, useRef, useEffect, useCallback } from "react";
import { useThoughtStore } from "../stores/thoughtStore";
import RelatedThoughtsHint from "./RelatedThoughtsHint";

interface FilePreview {
  name: string;
  dataUrl: string | null;
  base64: string;
  ext: string;
  isImage: boolean;
  size: number;
}

function fileToPreview(file: File): Promise<FilePreview | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) { resolve(null); return; }
      const rawExt = file.name.split(".").pop()?.toLowerCase() || "bin";
      const ext = rawExt === "jpeg" ? "jpg" : rawExt;
      const isImage = file.type.startsWith("image/");
      resolve({ name: file.name, dataUrl: isImage ? dataUrl : null, base64: match[2], ext, isImage, size: file.size });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ThoughtInput() {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [recentThoughtId, setRecentThoughtId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<FilePreview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const addThought = useThoughtStore((s) => s.addThought);
  const addThoughtWithImage = useThoughtStore((s) => s.addThoughtWithImage);
  const enrichAndEmbed = useThoughtStore((s) => s.enrichAndEmbed);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const preview = await fileToPreview(file);
            if (preview) setAttachment(preview);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleSubmit = async () => {
    const text = input.trim();
    if ((!text && !attachment) || saving) return;
    setSaving(true);
    try {
      let thought;
      if (attachment) {
        const label = attachment.isImage ? "[图片]" : `[文件] ${attachment.name}`;
        thought = await addThoughtWithImage(text || label, attachment.base64, attachment.ext, attachment.name);
        setAttachment(null);
      } else {
        thought = await addThought(text);
      }
      setInput("");
      setRecentThoughtId(thought.id);
      enrichAndEmbed(thought.id);
    } catch (e) {
      console.error("Failed to save thought:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const preview = await fileToPreview(files[0]);
      if (preview) setAttachment(preview);
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const preview = await fileToPreview(file);
      if (preview) setAttachment(preview);
    }
    e.target.value = "";
  };

  return (
    <section className="mb-16">
      <div
        className={`bg-surface-container-low p-8 rounded-2xl ghost-border shadow-2xl transition-all ${
          dragOver ? "ring-2 ring-primary/30" : ""
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-headline tracking-widest text-primary opacity-80 uppercase">
            Capture Inspiration
          </h2>
          <span className="text-[10px] text-on-surface-variant/60 font-mono">CTRL + N</span>
        </div>

        {/* Attachment preview */}
        {attachment && (
          <div className="mb-6">
            {attachment.isImage ? (
              <div className="relative rounded-xl overflow-hidden bg-surface-container-lowest">
                <img src={attachment.dataUrl!} alt="预览" className="max-h-40 w-auto mx-auto object-contain" />
                <button
                  onClick={() => setAttachment(null)}
                  className="absolute top-2 right-2 p-1.5 bg-surface/80 hover:bg-surface rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-surface-container-lowest px-4 py-3">
                <span className="material-symbols-outlined text-primary/60">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{attachment.name}</p>
                  <p className="text-[10px] text-on-surface-variant">{formatSize(attachment.size)}</p>
                </div>
                <button onClick={() => setAttachment(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={attachment ? "添加描述（可选）..." : "What's sparking your creativity today?"}
          className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-2xl font-headline font-light text-on-surface placeholder:text-on-surface-variant/20 resize-none min-h-[120px] mb-6"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={saving}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10">
          <div className="flex gap-4">
            <button
              onClick={() => { fileInputRef.current!.accept = "image/*"; fileInputRef.current?.click(); }}
              className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">image</span>
              <span className="text-[11px] font-medium tracking-wide uppercase">Add Visual</span>
            </button>
            <button
              onClick={() => { fileInputRef.current!.accept = "*/*"; fileInputRef.current?.click(); }}
              className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">attach_file</span>
              <span className="text-[11px] font-medium tracking-wide uppercase">File</span>
            </button>
          </div>
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
          <button
            onClick={handleSubmit}
            disabled={(!input.trim() && !attachment) || saving}
            className="bg-primary text-on-primary px-8 py-2 rounded-full font-headline font-bold text-xs uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
        </div>

        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/5 rounded-2xl pointer-events-none">
            <div className="text-primary font-medium flex items-center gap-2">
              <span className="material-symbols-outlined">upload_file</span>
              松开以添加文件
            </div>
          </div>
        )}
      </div>

      {recentThoughtId && (
        <RelatedThoughtsHint thoughtId={recentThoughtId} onDismiss={() => setRecentThoughtId(null)} />
      )}
    </section>
  );
}
