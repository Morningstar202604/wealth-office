import { motion } from 'framer-motion'
import { Bot, Check, Loader2 } from 'lucide-react'
import type { AgentInfo, AgentPhase } from '@/lib/types'
import type { AgentStep } from '@/lib/agentStore'
import { AGENT_ICON, toneTextClass } from '@/lib/agents'
import { cn } from '@/lib/utils'

export function AgentStepCard({
  info,
  step,
  compact = false,
}: {
  info: AgentInfo
  step?: AgentStep
  compact?: boolean
}) {
  const Icon = AGENT_ICON[info.id] ?? Bot
  const phase: AgentPhase = step?.phase ?? 'idle'
  const running = phase === 'running'
  const done = phase === 'done'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className={cn(
        'rounded-xl border border-border bg-card p-3 shadow-soft transition-colors',
        running && 'border-primary/40 bg-primary/[0.04]',
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent', running && 'animate-pulse-ring')}>
          <Icon className={cn('h-5 w-5', toneTextClass(info.tone))} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{info.label}</span>
              {!compact && <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{info.role}</span>}
            </div>
            <StatusPill phase={phase} />
          </div>
          {step?.detail && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
          )}
          {done && step?.artifact != null && (
            <details className="group mt-2">
              <summary className="cursor-pointer select-none text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                查看结构化产物
              </summary>
              <pre className="scroll-thin mt-1 max-h-56 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-snug text-foreground/80">
                {JSON.stringify(step.artifact, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function StatusPill({ phase }: { phase: AgentPhase }) {
  if (phase === 'running')
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        工作中
      </span>
    )
  if (phase === 'done')
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-700">
        <Check className="h-3 w-3" />
        完成
      </span>
    )
  return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">待命</span>
}
