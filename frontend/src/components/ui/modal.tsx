import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/** 轻量 Modal：居中卡片 + 遮罩 + 关闭。 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className={cn(
          "card-surface w-full sm:rounded-2xl rounded-t-2xl shadow-lift p-[var(--card-pad)] max-h-[88vh] overflow-y-auto scroll-thin",
          wide ? "sm:max-w-lg" : "sm:max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">{title}</div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-sm">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
