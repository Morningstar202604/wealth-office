import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 设置面板：前端可视化调整后端配置。
 *  分组：账本假设 / 晨报调度 / 行情源 / 数据管理 / 系统信息（只读）。 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/settings').then((r) => r.json())
      setData(d)
      setForm({
        monthly_income: String(d?.settings?.monthly_income ?? ''),
        emergency_target_months: String(d?.settings?.emergency_target_months ?? ''),
        essential_categories: String(d?.settings?.essential_categories ?? ''),
        report_interval_minutes: String(d?.settings?.report_interval_minutes ?? ''),
        quote_source_mode: String(d?.settings?.quote_source_mode ?? 'auto'),
      })
    } catch (e) {
      setError(`加载设置失败：${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setSaved(null)
    setError(null)
    const numeric: Array<[string, string]> = [
      ['monthly_income', '月收入'],
      ['emergency_target_months', '应急金目标月数'],
      ['report_interval_minutes', '晨报周期（分钟）'],
    ]
    const clientErrors: string[] = []
    for (const [k, label] of numeric) {
      const raw = (form[k] ?? '').trim()
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) clientErrors.push(`${label}必须是数字`)
      else if (n < 0) clientErrors.push(`${label}不能为负`)
      else if (k === 'report_interval_minutes' && n < 1) clientErrors.push('晨报周期至少 1 分钟')
    }
    if (clientErrors.length) {
      setSaving(false)
      setError(clientErrors.join('；'))
      return
    }
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: form }),
      }).then((x) => x.json())
      if (r?.errors?.length) setError(r.errors.join('；'))
      else setSaved('已保存，下一轮问答即生效')
      if (r?.settings) setData((d: any) => ({ ...d, settings: r.settings }))
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const resetSeed = async () => {
    if (!window.confirm('确认清空当前持仓/账本，恢复为示例数据？此操作不可撤销。')) return
    setResetting(true)
    try {
      await fetch('/api/portfolio/reset', { method: 'POST' })
      setSaved('已恢复示例数据')
    } finally {
      setResetting(false)
    }
  }

  const field = (k: string) => ({
    value: form[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  })

  const sch = data?.scheduler
  const health = data?.health
  const source = data?.source

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-foreground/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 flex max-h-[88vh] w-[92%] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lift">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          {!data && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          )}

          {data && (
            <>
              <section className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground">账本假设（影响账本管家与风控官的判定）</h3>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/80">月收入（元）</span>
                  <input type="number" {...field('monthly_income')} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/50" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/80">应急金目标（可支撑月数）</span>
                  <input type="number" step="0.5" {...field('emergency_target_months')} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/50" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/80">必要支出类别（应急金口径，逗号分隔）</span>
                  <input type="text" {...field('essential_categories')} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/50" />
                </label>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground">定时晨报</h3>
                <label className="block">
                  <span className="mb-1 block text-xs text-foreground/80">生成周期（分钟，1440 = 每天）</span>
                  <input type="number" {...field('report_interval_minutes')} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/50" />
                </label>
                {sch && (
                  <p className="text-xs text-muted-foreground">
                    调度器{sch.enabled ? '运行中' : '已停止'} · 已生成 {sch.generated} 次
                    {sch.next_run_at ? ` · 下次 ${sch.next_run_at}` : ''}
                    {sch.last_error ? <span className="text-red-600"> · 上次错误：{sch.last_error}</span> : ''}
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">行情源</h3>
                {(
                  [
                    ['auto', '自动（推荐）', '探测东财/yfinance，可用则实时价，否则快照价'],
                    ['eastmoney', '东方财富', 'push2 批量实时行情；网络不可用时自动降级快照'],
                    ['snapshot', '快照价', '使用组合库中录入的价格，结果可复现、零网络'],
                    ['yfinance', '实时价', 'Yahoo Finance（当前该网络被限流时单标的自动降级快照）'],
                  ] as const
                ).map(([v, label, desc]) => (
                  <label key={v} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 has-[:checked]:border-primary/50">
                    <input
                      type="radio"
                      name="quote_source_mode"
                      checked={(form.quote_source_mode ?? 'auto') === v}
                      onChange={() => setForm((f) => ({ ...f, quote_source_mode: v }))}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-foreground">{label}</span>
                      <span className="block text-[11px] text-muted-foreground">{desc}</span>
                    </span>
                  </label>
                ))}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">数据管理</h3>
                <button
                  type="button"
                  onClick={resetSeed}
                  disabled={resetting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {resetting ? '恢复中…' : '恢复示例数据（清空我的修改）'}
                </button>
              </section>

              <section className="space-y-1 rounded-lg border border-border bg-card/60 p-3">
                <h3 className="text-xs font-medium text-muted-foreground">系统信息</h3>
                <p className="text-xs text-muted-foreground">
                  模型：{health?.model || '-'}（{health?.llm_configured ? '已配置' : '未配置，模板兜底'}）
                </p>
                <p className="break-all text-xs text-muted-foreground">端点：{health?.endpoint || '-'}</p>
                <p className="text-xs text-muted-foreground">
                  数据来源：{source?.portfolio} · 行情：{source?.quotes}
                  {source?.seeded ? '（示例数据）' : '（你的数据）'}
                </p>
                <p className="text-xs text-muted-foreground">编排：LangGraph · 前端 assistant-ui</p>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-xs">
            {error ? <span className="text-red-600">{error}</span> : saved ? <span className="text-emerald-600">{saved}</span> : ''}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !data}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
