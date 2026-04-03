import { AlertTriangle, Archive, RotateCcw, Trash2 } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  icon?: 'archive' | 'restore' | 'delete' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  variant = 'warning',
  icon = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const iconMap = {
    archive: Archive,
    restore: RotateCcw,
    delete: Trash2,
    warning: AlertTriangle,
  };

  const Icon = iconMap[icon];

  const variantStyles = {
    danger: {
      icon: 'text-[#a8364b]',
      bg: 'bg-[#f97386]/10',
      border: 'border-[#f97386]/20',
      button: 'bg-[#a8364b] hover:bg-[#7d2435]',
    },
    warning: {
      icon: 'text-[#b45309]',
      bg: 'bg-amber-50',
      border: 'border-amber-200/50',
      button: 'bg-[#b45309] hover:bg-[#92400e]',
    },
    info: {
      icon: 'text-[#575b8c]',
      bg: 'bg-[#c1c5fd]/20',
      border: 'border-[#c1c5fd]/30',
      button: 'bg-[#575b8c] hover:bg-[#434670]',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onCancel}
      />
      
      {/* 对话框 */}
      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/60 w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* 内容区 */}
        <div className="p-6">
          <div className={`w-12 h-12 rounded-2xl ${styles.bg} ${styles.border} border flex items-center justify-center mb-4`}>
            <Icon className={`w-6 h-6 ${styles.icon}`} />
          </div>
          
          <h3 className="text-lg font-bold text-[#31323b] mb-2">
            {title}
          </h3>
          <p className="text-sm text-[#5e5e68] leading-relaxed">
            {message}
          </p>
        </div>

        {/* 按钮区 */}
        <div className="flex gap-3 p-6 pt-0">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 text-sm font-medium rounded-xl bg-white/60 text-[#5e5e68] hover:bg-white border border-[#e3e1ed]/50 transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-3 text-sm font-medium rounded-xl text-white ${styles.button} transition-all shadow-lg`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
