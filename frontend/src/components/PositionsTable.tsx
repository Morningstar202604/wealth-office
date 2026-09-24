import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct, pnlClass } from "@/lib/format";
import type { Position } from "@/lib/types";

type SortKey = "weight" | "market_value" | "pnl" | "pnl_pct";

/** 持仓数据表：可排序、数字右对齐等宽、盈亏红涨绿跌。
 *  市值/盈亏由后端算好传入（与问答、图表同源，避免口径不一致）。 */
export function PositionsTable({
  rows,
  total,
  className,
}: {
  rows: Position[];
  total?: number;
  className?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [desc, setDesc] = useState(true);

  const computed = useMemo(() => {
    const t = total ?? rows.reduce((s, r) => s + r.market_value, 0);
    return rows
      .map((r) => ({ ...r, weight: t ? (r.market_value / t) * 100 : 0 }))
      .sort((a, b) => (desc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
  }, [rows, total, sortKey, desc]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) setDesc((v) => !v);
    else {
      setSortKey(k);
      setDesc(true);
    }
  };

  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground text-right"
      onClick={() => toggle(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k ? (
          desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </span>
    </th>
  );

  return (
    <div className={cn("scroll-thin overflow-x-auto rounded-lg border border-border bg-card", className)}>
      <table className="w-full border-collapse text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">标的</th>
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">类型</th>
            <SortHead k="weight" label="占比" />
            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">现价</th>
            <SortHead k="market_value" label="市值" />
            <SortHead k="pnl" label="盈亏" />
            <SortHead k="pnl_pct" label="盈亏%" />
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.symbol} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
              <td className="px-2 py-1.5">
                <div className="font-medium text-foreground">{r.name}</div>
                <div className="text-[10px] text-muted-foreground">{r.symbol}</div>
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{r.kind}</td>
              <td className="px-2 py-1.5 text-right">
                <span
                  className={cn(
                    "rounded px-1 py-0.5",
                    r.weight > 40 ? "bg-amber-100 text-amber-700" : "text-foreground",
                  )}
                >
                  {r.weight.toFixed(1)}%
                </span>
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtMoney(r.last)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(r.market_value)}</td>
              <td className={cn("px-2 py-1.5 text-right", pnlClass(r.pnl))}>{fmtMoney(r.pnl, true)}</td>
              <td className={cn("px-2 py-1.5 text-right", pnlClass(r.pnl))}>{fmtPct(r.pnl_pct, true)}</td>
            </tr>
          ))}
          {computed.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                暂无持仓数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
