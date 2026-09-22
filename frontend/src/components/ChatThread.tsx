import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { ArrowUp, ChevronDown, Sparkles } from 'lucide-react'
import { ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react'
import type { AssistantRuntime } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import * as store from '@/lib/agentStore'
import { PositionsTable } from './PositionsTable'
import type { PositionRow } from './PositionsTable'
import { SummaryBlock } from './SummaryBlock'
import { PipelineStepper } from './PipelineStepper'
import { StickyActionBar } from './StickyActionBar'
import { HistorySection } from './HistorySection'
import { routeLabel } from '@/lib/agents'

const PRESETS = [
  '我这个月的钱都花到哪了？',
  '我的组合现在什么情况？',
  '帮我看看有哪些风险',
  '应急金够吗？订阅是不是太多了',
]

// react-markdown：Claude/ChatGPT 式阅读排版——15px、宽行距、段落呼吸
const mdComponents: Record<string, ComponentType<any>> = {
  h1: (p) => <h1 className="mb-3 mt-5 text-base font-semibold text-foreground" {...p} />,
  h2: (p) => <h2 className="mb-2.5 mt-5 text-[15px] font-semibold text-foreground" {...p} />,
  h3: (p) => <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground" {...p} />,
  p: (p) => <p className="my-3 leading-7" {...p} />,
  ul: (p) => <ul className="my-3 list-disc space-y-1.5 pl-5" {...p} />,
  ol: (p) => <ol className="my-3 list-decimal space-y-1.5 pl-5" {...p} />,
  li: (p) => <li className="leading-7" {...p} />,
  strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
  em: (p) => <em className="text-muted-foreground" {...p} />,
  code: (p) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-brand-teal" {...p} />
  ),
  a: (p) => <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />,
  blockquote: (p) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground" {...p} />
  ),
  table: (p) => <table className="my-3 w-full border-collapse text-xs" {...p} />,
  th: (p) => <th className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground" {...p} />,
  td: (p) => <td className="border-b border-border/60 px-2 py-1.5" {...p} />,
}

const ThreadMarkdown: ComponentType<any> = (props) => (
  <MarkdownTextPrimitive
    {...props}
    components={mdComponents}
    className="text-[15px] leading-7 text-foreground/95"
    smooth={false}
    defer
  />
)

export function ChatThread({ runtime }: { runtime: AssistantRuntime }) {
  const pending = useSyncExternalStore(store.subscribe, () => {
    const st = store.getState()
    return (st.currentMessageId ? st.byMessage[st.currentMessageId]?.pendingConfirm : null) ?? null
  })

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <HistorySection />
          <ThreadPrimitive.Empty>
            <Welcome runtime={runtime} />
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === 'user' ? (
                <UserMessage key={message.id} />
              ) : (
                <AssistantMessage key={message.id} messageId={message.id} runtime={runtime} />
              )
            }
          </ThreadPrimitive.Messages>
        </div>
      </ThreadPrimitive.Viewport>
      {pending && <StickyActionBar payload={pending} />}
      <Composer />
    </ThreadPrimitive.Root>
  )
}

function Welcome({ runtime }: { runtime: AssistantRuntime }) {
  const send = (text: string) => {
    runtime.thread.append({ role: 'user', content: [{ type: 'text', text }] })
  }
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">你的专属理财团队已就位</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        首席顾问会先判断你的问题该派给谁，再由行情分析员与账本管家并行取数，最后交风控官复核、文书成文。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => send(p)}
            className="rounded-full border border-border bg-card px-3.5 py-2 text-xs text-foreground/75 transition-colors hover:border-primary/50 hover:text-primary"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function UserMessage() {
  // ChatGPT 式：右对齐浅灰气泡，不用高饱和色块
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-muted px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{ Text: (p: { text: string }) => <>{p.text}</> }}
        />
      </div>
    </div>
  )
}

/** 依据风控 flags 生成追问建议（结果 → 推荐动作） */
function followUps(flags: { code: string }[]): string[] {
  const has = (c: string) => flags.some((f) => f.code === c)
  const out: string[] = []
  if (has('CONCENTRATION')) out.push('怎么把集中度降到阈值以内？')
  if (has('EMERGENCY_FUND')) out.push('应急金要补到多少才够？')
  if (has('HIGH_RATE_DEBT')) out.push('高息负债怎么处理更划算？')
  if (out.length < 2) out.push('我的订阅里哪些可以砍掉？')
  if (out.length < 3) out.push('生成今日晨报')
  return out.slice(0, 3)
}

function AssistantMessage({
  messageId,
  runtime,
}: {
  messageId: string
  runtime: AssistantRuntime
}) {
  const steps = useSyncExternalStore(store.subscribe, () => store.getState().byMessage[messageId])
  const roster = store.getState().roster
  const fm = steps?.finalMeta
  const pendingConfirm = steps?.pendingConfirm ?? null

  const market = steps?.agents.market?.artifact as
    | { total_market_value?: number; total_pnl?: number; total_pnl_pct?: number }
    | undefined
  const ledger = steps?.agents.ledger?.artifact as
    | { net?: number; savings_rate?: number }
    | undefined
  const flags = (steps?.agents.risk?.artifact as { flags?: { code: string; text: string }[] } | undefined)?.flags ?? []

  const [rows, setRows] = useState<PositionRow[]>([])
  useEffect(() => {
    fetch('/api/portfolio')
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d?.positions) ? d.positions : []))
      .catch(() => {})
  }, [])

  return (
    <div>
      {/* 头部一行：轻拟物，不包卡片——答案直接铺在页面上（Claude/ChatGPT 式） */}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="font-medium text-foreground">团队汇报</span>
        <span>· 5 位智能体协作</span>
        {pendingConfirm && <span className="text-amber-600">· 待人审</span>}
        {fm && !pendingConfirm && (
          <span className={fm.level.startsWith('L2') ? 'text-amber-600' : 'text-emerald-600'}>
            · {fm.level}
          </span>
        )}
      </div>

      <div className="space-y-4">
        <SummaryBlock market={market} ledger={ledger} flags={flags} level={null} quiet />

        <div>
          <MessagePrimitive.Parts components={{ Text: ThreadMarkdown }} />
        </div>

        {rows.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">持仓明细</h3>
            <PositionsTable rows={rows} dense />
          </div>
        )}

        <PipelineStepper roster={roster} steps={steps} />

        {fm && (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <span>派给：{routeLabel(fm.route)}</span>
            <span>模型调用 {fm.llm_calls} 次{fm.llm_fallbacks > 0 && ` · 模板兜底 ${fm.llm_fallbacks}`}</span>
          </div>
        )}

        {fm && !pendingConfirm && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {followUps(flags).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => runtime.thread.append({ role: 'user', content: [{ type: 'text', text: q }] })}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-primary/50 hover:text-primary"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Composer() {
  const disclaimer = useSyncExternalStore(store.subscribe, () => store.getState().disclaimer)
  return (
    <div className="px-4 pb-4 pt-2">
      <ComposerPrimitive.Root className="mx-auto flex max-w-3xl items-end gap-2 rounded-[26px] border border-border bg-card px-4 py-2.5 shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="问点什么，比如：我这个月的钱都花到哪了？"
          className="scroll-thin max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <ComposerPrimitive.Send className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">{disclaimer}</p>
    </div>
  )
}
