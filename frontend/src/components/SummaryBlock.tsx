import { Badge } from "@/components/ui/badge";
import { fmtMoney, pnlClass } from "@/lib/format";
import type { AnswerMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 回答尾部摘要：等级 + 关键数字 + 风险提示（全部来自后端 final 事件，口径唯一）。 */
export function SummaryBlock({ meta }: { meta: AnswerMeta }) {
  const m = meta.metrics;
  const chips: { label: string; value: string; cls?: string }[] = [];
  if (m.total_market_value != null)
    chips.push({ label: "总市值", value: fmtMoney(m.total_market_value) });
  if (m.total_pnl != null)
    chips.push({
      label: "累计盈亏",
      value: fmtMoney(m.total_pnl, true),
      cls: pnlClass(m.total_pnl),
    });
  if (m.net != null) chips.push({ label: "本月结余", value: fmtMoney(m.net, true) });
  if (m.savings_rate != null) chips.push({ label: "储蓄率", value: `${m.savings_rate}%` });
  if (m.debt_monthly != null)
    chips.push({ label: "负债月供", value: `${fmtMoney(m.debt_monthly)}/月` });

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Badge variant={meta.level === "L2 建议" ? "warn" : "ok"}>{meta.level}</Badge>
        <span className="text-xs text-muted-foreground">
          {meta.llm === "llm" ? "智能问答" : "基于你的数据计算"}
        </span>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
          {chips.map((c) => (
            <span key={c.label} className="text-muted-foreground">
              {c.label}
              <b className={cn("ml-1 text-foreground", c.cls)}>{c.value}</b>
            </span>
          ))}
        </div>
      )}
      {meta.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {meta.flags.map((f, i) => (
            <li key={i} className="text-xs text-amber-700 dark:text-amber-400">
              · {f.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
