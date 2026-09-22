import { useState, useSyncExternalStore } from 'react'
import { Archive, ChevronDown, ChevronRight, Newspaper } from 'lucide-react'
import * as store from '@/lib/agentStore'
import type { HistoryRun } from '@/lib/types'
import { Badge } from './ui/badge'
import { routeLabel } from '@/lib/agents'

/** 跨会话历史：后端持久化的过往问答。刷新页面 / 重启后端后依然在。
 *  默认只展开最近 5 条（落地页首屏让给欢迎区），其余折叠在"展开全部"里。 */
const PREVIEW_COUNT = 5

export function HistorySection() {
  const history = useSyncExternalStore(store.subscribe, () => store.getState().history)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (!history.length) return null

  const generateReport = async () => {
    setGenerating(true)
    try {
      await fetch('/api/reports/generate', { method: 'POST' })
      const d = await fetch('/api/history?limit=20').then((r) => r.json())
      store.setHistory(Array.isArray(d?.runs) ? d.runs : [])
    } catch {
      // 生成失败保持现状；后端 /api/scheduler 里能看到 last_error
    } finally {
      setGenerating(false)
    }
  }

  const visible = expanded ? history : history.slice(0, PREVIEW_COUNT)
  const hidden = history.length - visible.length

  return (
    <div className="mb-4 rounded-xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">历史记录 · {history.length} 轮</span>
        <Badge variant="secondary" className="text-[10px]">
          跨会话持久化
        </Badge>
        <button
          type="button"
          onClick={generateReport}
          disabled={generating}
          className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-foreground/75 transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
          title="立即生成一次定时晨报（平时由后台按 report_interval_minutes 自动生成）"
        >
          <Newspaper className="h-3 w-3" />
          {generating ? '生成中…' : '生成晨报'}
        </button>
      </div>
      <ul className="divide-y divide-border/60">
        {visible.map((run) => (
          <HistoryRow key={run.id} run={run} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-border/60 px-3 py-2 text-center text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          展开更早的 {hidden} 轮
        </button>
      )}
    </div>
  )
}

function HistoryRow({ run }: { run: HistoryRun }) {
  const [open, setOpen] = useState(false)
  const warn = (run.level || '').startsWith('L2')

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
          {run.question}
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
          {run.route ? routeLabel(run.route) : ''}
        </span>
        <Badge variant={warn ? 'warn' : 'ok'} className="shrink-0 text-[10px]">
          {run.level}
        </Badge>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">
          {run.created_at}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/50 bg-background/40 px-4 py-3">
          <p className="mb-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {run.answer}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>派给：{run.route ? routeLabel(run.route) : '-'}</span>
            <span>模型调用 {run.llm_calls} 次</span>
            <span>步骤事件 {Array.isArray(run.trace) ? run.trace.length : 0} 条</span>
          </div>
        </div>
      )}
    </li>
  )
}
