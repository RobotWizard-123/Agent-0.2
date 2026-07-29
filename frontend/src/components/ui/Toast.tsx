import type { Toast as ToastType } from "../../types/common";

interface ToastProps {
  toasts: ToastType[];
}

export function Toast({ toasts }: ToastProps) {
  return (
    <div className="toast-root">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
