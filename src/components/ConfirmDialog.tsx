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

const iconMap: Record<string, string> = {
  archive: "inventory_2",
  restore: "restore",
  delete: "delete",
  warning: "warning",
};

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

  const variantStyles = {
    danger: {
      icon: 'text-error',
      bg: 'bg-error-container/20',
      button: 'bg-error hover:bg-error/80',
    },
    warning: {
      icon: 'text-tertiary',
      bg: 'bg-tertiary-container/20',
      button: 'bg-tertiary hover:bg-tertiary/80',
    },
    info: {
      icon: 'text-primary',
      bg: 'bg-primary/10',
      button: 'bg-primary hover:bg-primary/80',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative bg-surface-container-high rounded-2xl w-full max-w-md mx-4 overflow-hidden ghost-border">
        <div className="p-6">
          <div className={`w-12 h-12 rounded-xl ${styles.bg} flex items-center justify-center mb-4`}>
            <span className={`material-symbols-outlined text-[24px] ${styles.icon}`}>{iconMap[icon]}</span>
          </div>

          <h3 className="text-lg font-headline font-bold text-on-surface mb-2">{title}</h3>
          <p className="text-sm text-on-surface-variant leading-relaxed">{message}</p>
        </div>

        <div className="flex gap-3 p-6 pt-0">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 text-sm font-medium rounded-xl bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-3 text-sm font-medium rounded-xl text-on-primary ${styles.button} transition-all`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
