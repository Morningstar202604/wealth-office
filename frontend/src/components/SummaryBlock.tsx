import { fmtMoney, fmtPct, pnlClass } from '@/lib/format'

/** 结论摘要：一行安静的灰色元信息（· 分隔），不再用芯片/底色/大徽章。
 *  关键数字保留涨跌色便于扫读，其余全部去噪。 */
export function SummaryBlock({
  market,
  ledger,
  flags,
}: {
  market?: { total_market_value?: number; total_pnl?: number; total_pnl_pct?: number } | null
  ledger?: { net?: number; savings_rate?: number } | null
  flags?: { code: string; text: string }[] | null
  level?: string | null
  quiet?: boolean
}) {
  const parts: { label: string; value: string; cls?: string }[] = []
  if (market?.total_market_value != null)
    parts.push({ label: '总市值', value: fmtMoney(market.total_market_value) })
  if (market?.total_pnl != null)
    parts.push({
      label: '浮盈亏',
      value: `${fmtMoney(market.total_pnl, true)}（${fmtPct(market.total_pnl_pct, true)}）`,
      cls: pnlClass(market.total_pnl),
    })
  if (ledger?.net != null)
    parts.push({
      label: '本月结余',
      value: `${fmtMoney(ledger.net, true)}${ledger.savings_rate != null ? ` · 储蓄率 ${ledger.savings_rate}%` : ''}`,
      cls: pnlClass(ledger.net),
    })
  if (flags && flags.length > 0) parts.push({ label: '风险', value: `${flags.length} 项`, cls: 'text-amber-600' })

  if (parts.length === 0) return null

  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {parts.map((p, i) => (
        <span key={p.label} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-border">·</span>}
          <span>
            {p.label} <span className={p.cls ?? 'text-foreground/80'}>{p.value}</span>
          </span>
        </span>
      ))}
    </div>
  )
}
