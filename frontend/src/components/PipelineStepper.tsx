import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentInfo } from '@/lib/types'
import type { ThreadSteps } from '@/lib/agentStore'
import { AgentStepCard } from './AgentStepCard'
import { cn } from '@/lib/utils'

/** 协作过程：默认收成一行安静的小字（ChatGPT "思考过程"式），点开才看 stepper 与各步详情。 */
export function PipelineStepper({
  roster,
  steps,
}: {
  roster: AgentInfo[]
  steps?: ThreadSteps
}) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const done = roster.filter((a) => steps?.agents[a.id]?.phase === 'done').length
  const running = roster.find((a) => steps?.agents[a.id]?.phase === 'running')

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        协作过程 · {done}/{roster.length} 完成
        {running ? `（${running.label}工作中）` : ''}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-card/60 p-3">
          <div className="flex items-start">
            {roster.map((a, i) => {
              const phase = steps?.agents[a.id]?.phase ?? 'idle'
              const active = sel === a.id
              return (
                <div key={a.id} className="flex min-w-0 flex-1 items-start">
                  <button
                    type="button"
                    onClick={() => setSel(active ? null : a.id)}
                    className={cn(
                      'flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-0.5 transition-colors',
                      active && 'bg-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border text-[10px]',
                        phase === 'done' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
                        phase === 'running' && 'animate-pulse-ring border-primary bg-primary/10 text-primary',
                        phase === 'idle' && 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={cn(
                        'max-w-[56px] truncate text-[10px] leading-tight',
                        phase === 'idle' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {a.label}
                    </span>
                  </button>
                  {i < roster.length - 1 && (
                    <span
                      className={cn(
                        'mt-3 h-0.5 flex-1 rounded',
                        (steps?.agents[a.id]?.phase ?? 'idle') === 'done' ? 'bg-emerald-300' : 'bg-border',
                      )}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {(() => {
            const info = roster.find((a) => a.id === (sel ?? roster[0]?.id))
            if (!info) return null
            return <AgentStepCard info={info} step={steps?.agents[info.id]} />
          })()}
        </div>
      )}
    </div>
  )
}
