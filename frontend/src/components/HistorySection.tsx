import { useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { store } from "@/lib/store";
import type { RunRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function HistorySection() {
  const { history } = store.useApp();
  const [openId, setOpenId] = useState<number | null>(null);

  if (history.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-6">
        <History className="w-5 h-5 mx-auto mb-2 opacity-60" />
        还没有问答记录，去提问吧。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((r: RunRecord) => {
        const open = openId === r.id;
        return (
          <div key={r.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/40"
              onClick={() => setOpenId(open ? null : r.id)}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.question}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{fmtTime(r.created_at)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={r.level === "L2 建议" ? "warn" : "ok"}>{r.level}</Badge>
                {open ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>
            {open && (
              <div className="px-3 pb-3 pt-1 border-t border-border/60 bg-muted/20">
                <div className="max-w-none text-sm leading-relaxed text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.answer}</ReactMarkdown>
                </div>
                {r.flags.length > 0 && (
                  <div className="mt-2 text-xs text-amber-700">
                    当时提示：{r.flags.map((f) => f.text).join("；")}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
