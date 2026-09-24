/** 轻量 Toast 通知（无依赖）：右下角堆叠，自动消失。 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type ToastKind = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastCtx = createContext<{ toast: (text: string, kind?: ToastKind) => void } | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = seq++;
      setItems((prev) => [...prev.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  const icon =
    items.length > 0
      ? {
          ok: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
          error: <XCircle className="w-4 h-4 text-red-500 shrink-0" />,
          info: <Info className="w-4 h-4 text-sky-500 shrink-0" />,
        }[items[items.length - 1].kind]
      : null;

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto z-50 flex flex-col items-end gap-2">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur px-3.5 py-2.5 text-sm shadow-lift animate-fade-in max-w-[92vw]"
          >
            {t.kind === "ok" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : t.kind === "error" ? (
              <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-sky-500 shrink-0" />
            )}
            <span className="text-foreground text-left">{t.text}</span>
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}
