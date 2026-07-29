import type { ReactNode, MouseEvent } from "react";

interface DialogProps {
  label?: string;
  dismissible?: boolean;
  children: ReactNode;
  onClose: () => void;
}

export function Dialog({ label = "确认操作", dismissible = true, children, onClose }: DialogProps) {
  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && dismissible) onClose();
  };
  return (
    <div className="dialog-overlay" role="presentation" onClick={handleOverlayClick}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-label={label}>
        {children}
        {dismissible ? (
          <button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        ) : null}
      </section>
    </div>
  );
}
