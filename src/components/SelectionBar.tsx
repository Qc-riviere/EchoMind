interface Props {
  count: number;
  onSummarize: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function SelectionBar({ count, onSummarize, onCancel, busy }: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface-container-high rounded-full shadow-2xl border border-outline-variant/20 px-2 py-2 flex items-center gap-2 backdrop-blur-md">
      <span className="px-4 text-sm text-on-surface">
        已选 <span className="font-semibold text-primary">{count}</span> 条
      </span>
      <button
        onClick={onSummarize}
        disabled={count < 2 || busy}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
      >
        {busy ? (
          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
        )}
        AI 总结
      </button>
      <button
        onClick={onCancel}
        className="px-4 py-2 rounded-full text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        取消
      </button>
    </div>
  );
}
