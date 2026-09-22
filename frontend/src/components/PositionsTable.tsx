import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtPct, pnlClass } from '@/lib/format'

export interface PositionRow {
  symbol: string
  name: string
  kind: string
  industry: string
  shares: number
  cost: number
  last: number
}

type SortKey = 'market_value' | 'pnl' | 'pnl_pct' | 'weight'

/** 持仓数据表：可排序、数字右对齐等宽、盈亏红涨绿跌。
 *  rows 直接来自 GET /api/portfolio 的 positions（原样字段），市值/盈亏在此现算，
 *  保证与 agent 取数同源。weight 为该行占总市值的百分比（可选传 total）。 */
export function PositionsTable({
  rows,
  total,
  dense = false,
  className,
}: {
  rows: PositionRow[]
  total?: number
  dense?: boolean
  className?: string
}) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value')
  const [desc, setDesc] = useState(true)

  const computed = useMemo(() => {
    const t =
      total ??
      rows.reduce((s, r) => s + r.shares * r.last, 0)
    return rows
      .map((r) => {
        const mv = r.shares * r.last
        const cost = r.shares * r.cost
        const pnl = mv - cost
        return {
          ...r,
          market_value: mv,
          pnl,
          pnl_pct: cost ? (pnl / cost) * 100 : 0,
          weight: t ? (mv / t) * 100 : 0,
        }
      })
      .sort((a, b) => (desc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
  }, [rows, total, sortKey, desc])

  const toggle = (k: SortKey) => {
    if (k === sortKey) setDesc((v) => !v)
    else {
      setSortKey(k)
      setDesc(true)
    }
  }

  const SortHead = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th
      className={cn(
        'cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
        align === 'right' && 'text-right',
      )}
      onClick={() => toggle(k)}
    >
      <span className={cn('inline-flex items-center gap-0.5', align === 'right' && 'flex-row-reverse')}>
        {label}
        {sortKey === k ? (
          desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </span>
    </th>
  )

  return (
    <div className={cn('scroll-thin overflow-x-auto rounded-lg border border-border bg-card', className)}>
      <table className="w-full border-collapse text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">标的</th>
            {!dense && <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">类型</th>}
            <SortHead k="weight" label="占比" align="right" />
            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">现价</th>
            <SortHead k="market_value" label="市值" align="right" />
            <SortHead k="pnl" label="盈亏" align="right" />
            <SortHead k="pnl_pct" label="盈亏%" align="right" />
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.symbol} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
              <td className="px-2 py-1.5">
                <div className="font-medium text-foreground">{r.name}</div>
                <div className="text-[10px] text-muted-foreground">{r.symbol}</div>
              </td>
              {!dense && <td className="px-2 py-1.5 text-muted-foreground">{r.kind}</td>}
              <td className="px-2 py-1.5 text-right">
                <span className={cn('rounded px-1 py-0.5', r.weight > 40 ? 'bg-amber-100 text-amber-700' : 'text-foreground')}>
                  {r.weight.toFixed(1)}%
                </span>
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtMoney(r.last)}</td>
              <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(r.market_value)}</td>
              <td className={cn('px-2 py-1.5 text-right', pnlClass(r.pnl))}>{fmtMoney(r.pnl, true)}</td>
              <td className={cn('px-2 py-1.5 text-right', pnlClass(r.pnl))}>{fmtPct(r.pnl_pct, true)}</td>
            </tr>
          ))}
          {computed.length === 0 && (
            <tr>
              <td colSpan={dense ? 6 : 7} className="px-2 py-3 text-center text-muted-foreground">
                暂无持仓数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
