import { Check, ShieldAlert, X } from 'lucide-react'
import { resolveDecision } from '@/lib/confirmGate'
import type { ConfirmPayload } from '@/lib/types'

/** HITL 操作条：单行、安静的中性底（不再一大块黄），固定在视口与输入框之间。
 *  主流审批框做法：一行说明 + 主按钮 + 弱化次按钮。 */
export function StickyActionBar({ payload }: { payload: ConfirmPayload }) {
  const flags = Array.isArray(payload.flags) ? payload.flags : []
  const brief =
    flags.length > 0
      ? `${flags.length} 项风险提示：${flags[0].text}`
      : '涉及决策的建议需确认后交付'

  return (
    <div className="border-t border-border bg-card px-4 py-2.5">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-xs font-medium text-foreground">建议级汇报待人审</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{brief}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => resolveDecision(true)}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90"
          >
            <Check className="h-3.5 w-3.5" />
            批准交付
          </button>
          <button
            type="button"
            onClick={() => resolveDecision(false)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            扣留
          </button>
        </div>
      </div>
    </div>
  )
}
