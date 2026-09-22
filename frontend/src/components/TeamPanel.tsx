import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, GitBranch, RefreshCw, TriangleAlert, X } from 'lucide-react'
import * as store from '@/lib/agentStore'
import { PositionsTable } from './PositionsTable'
import type { PositionRow } from './PositionsTable'
import { Badge } from './ui/badge'
import { routeLabel } from '@/lib/agents'
import { fmtMoney, fmtPct, pnlClass } from '@/lib/format'

/** 工作台分区折叠：该展开的展开、该收的收。 */
function Fold({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string
  defaultOpen?: boolean
  badge?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex w-full items-center gap-1 px-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
        {badge && <span className="font-normal text-border">· {badge}</span>}
      </button>
      {open && children}
    </section>
  )
}

/** 数据工作台正文：持仓表 + 负债表 + 风控检查单。右栏与窄屏抽屉共用。 */
export function WorkbenchContent({ onClose }: { onClose?: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const mid = state.currentMessageId
  const steps = mid ? state.byMessage[mid] : undefined
  const supervisorArtifact = steps?.agents.supervisor?.artifact as
    | { route?: string; reason?: string; classified_by?: string }
    | undefined
  const fm = steps?.finalMeta
  const flags =
    (steps?.agents.risk?.artifact as { flags?: { code: string; text: string }[] } | undefined)?.flags ?? []

  const [positions, setPositions] = useState<PositionRow[]>([])
  const [debts, setDebts] = useState<{ name: string; monthly: number; balance: number; rate: number }[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/portfolio').then((r) => r.json())
      setPositions(Array.isArray(d?.positions) ? d.positions : [])
      setDebts(Array.isArray(d?.debts) ? d.debts : [])
    } catch {
      // 数据面板拉取失败不打断主流程；保留旧数据
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, mid])

  const monthlyDebt = debts.reduce((s, d) => s + d.monthly, 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">数据工作台</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            title="重新拉取组合库"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3">
        <Fold title="派活决策" defaultOpen={false} badge={supervisorArtifact?.route ? routeLabel(supervisorArtifact.route) : undefined}>
          {supervisorArtifact?.route ? (
            <div className="rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-primary">
                <GitBranch className="h-3.5 w-3.5" />
                {supervisorArtifact.classified_by ?? '规则'}分类
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{supervisorArtifact.reason}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground">
              等待一轮问答后显示
            </div>
          )}
        </Fold>

        <Fold title="持仓" defaultOpen badge={`${positions.length} 项`}>
          <PositionsTable rows={positions} dense />
        </Fold>

        <Fold title="负债" defaultOpen={false} badge={debts.length ? `月供 ${fmtMoney(monthlyDebt)}` : undefined}>
          {debts.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">名称</th>
                    <th className="px-2 py-1.5 text-right font-medium">余额</th>
                    <th className="px-2 py-1.5 text-right font-medium">月供</th>
                    <th className="px-2 py-1.5 text-right font-medium">利率</th>
                  </tr>
                </thead>
                <tbody>
                  {debts.map((d) => (
                    <tr key={d.name} className="border-b border-border/60 last:border-0">
                      <td className="px-2 py-1.5">
                        <span className={d.rate >= 0.08 ? 'font-medium text-amber-700' : 'text-foreground'}>
                          {d.name}
                        </span>
                        {d.rate >= 0.08 && <span className="ml-1 text-[10px] text-amber-700">高息</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">{fmtMoney(d.balance)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtMoney(d.monthly)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtPct(d.rate * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground">
              无负债记录
            </div>
          )}
        </Fold>

        <Fold title="风控检查单" defaultOpen badge={fm ? (flags.length ? `${flags.length} 项提示` : '通过') : undefined}>
          {flags.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground">
              {fm ? '本轮复核通过，无风险提示' : '等待一轮问答后显示'}
            </div>
          ) : (
            <ul className="space-y-1">
              {flags.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-xs leading-snug text-amber-900"
                >
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Fold>
      </div>

      {fm && (
        <div className="space-y-1 border-t border-border p-3 text-[11px] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>交付等级</span>
            <Badge variant={fm.level.startsWith('L2') ? 'warn' : 'ok'}>{fm.level}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>模型调用</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fm.llm_calls} 次{fm.llm_fallbacks > 0 && ` · 模板兜底 ${fm.llm_fallbacks}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 右栏容器（lg+ 常驻）；窄屏由 App 的抽屉复用 WorkbenchContent。 */
export function TeamPanel({ onClose }: { onClose?: () => void }) {
  return (
    <aside className="h-full min-h-0 border-l border-border">
      <WorkbenchContent onClose={onClose} />
    </aside>
  )
}
