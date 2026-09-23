// 把后端 SSE 桥接成 assistant-ui 的 ChatModelAdapter。
//
// 关键语义（已读 runtime 源码确认）：每次 yield 的 content 是「追加」到消息的，
// 因此文本必须按增量（这里按段落）逐段 yield；tool-call 不可靠重复 yield 更新，
// 所以「agent 步骤卡」交给自有 store + 组件渲染，thread 里只流式 markdown 答案。

import type { ChatModelAdapter } from '@assistant-ui/react'
import * as store from '@/lib/agentStore'
import { abortPending, waitDecision } from '@/lib/confirmGate'
import { streamAsk, streamResume } from '@/lib/sse'
import type { AgentProcessEvent, ConfirmPayload, FinalMeta } from '@/lib/types'

const ORDER = ['supervisor', 'market', 'ledger', 'risk', 'finalize']

/** 稳定的会话 id：让多轮问答归到同一条 thread，后端按它持久化跨会话历史。 */
function threadId(): string {
  let id = ''
  try {
    id = localStorage.getItem('wealth.thread_id') || ''
    if (!id) {
      id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem('wealth.thread_id', id)
    }
  } catch {
    id = 'default'
  }
  return id
}

export const wealthAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, unstable_assistantMessageId }) {
    const mid = unstable_assistantMessageId ?? 'run-default'

    const userText =
      messages
        .filter((m) => m.role === 'user')
        .pop()
        ?.content.filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join('') ?? ''

    store.initRun(mid, ORDER)

    let answer = ''
    let meta: FinalMeta | null = null

    const onEvent = (ev: AgentProcessEvent) => {
      if (!ev.agent) return
      store.setStep(mid, ev.agent, {
        phase: ev.phase === 'start' ? 'running' : 'done',
        label: ev.label,
        detail: ev.detail,
        artifact: ev.artifact,
      })
    }
    let confirm: ConfirmPayload | null = null
    const onConfirmRequired = (p: ConfirmPayload) => {
      confirm = p
      store.setPendingConfirm(mid, p)
    }
    const onError = (message: string) => {
      answer = `请求失败：${message}`
    }
    const onFinal = (f: FinalMeta) => {
      answer = f.answer
      meta = f
      store.setFinal(mid, f)
      // 本轮已由后端归档进 runs 表：立刻刷新历史面板，避免"新一轮不入历史"直到刷新才出现
      fetch('/api/history?limit=20')
        .then((r) => r.json())
        .then((d) => store.setHistory(Array.isArray(d?.runs) ? d.runs : []))
        .catch(() => {})
    }

    try {
      await streamAsk(userText, abortSignal, { onEvent, onFinal, onConfirmRequired, onError }, threadId())

      // HITL：L2 建议级在后端 interrupt 暂停 → 等用户批准/扣留 → 续跑到同一条消息里
      // （闭包内赋值不改 TS 收窄，这里显式断言：streamAsk 返回后 confirm 才可能被置上）
      const pending = confirm as ConfirmPayload | null
      if (pending) {
        abortSignal.addEventListener('abort', abortPending, { once: true })
        try {
          const decision = await waitDecision()
          abortSignal.removeEventListener('abort', abortPending)
          store.clearPendingConfirm(mid)
          // 批准与扣留都走 /api/resume：后端据此交付汇报或"已扣留"文案，并统一归档
          await streamResume(
            { ckpt_id: pending.ckpt_id, thread_id: pending.thread_id, approved: decision.approved },
            abortSignal,
            { onEvent, onFinal, onError },
          )
        } catch {
          abortSignal.removeEventListener('abort', abortPending)
          store.clearPendingConfirm(mid)
          throw new Error('人审决策中断')
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        answer = `请求失败：${(err as Error).message}`
      }
    }

    // 段落流式输出。⚠️ yield 是「替换」语义（runtime: content = [...initialContent, ...本次yield]，
    // initialContent = 本轮开始前内容）——每次必须给**全量累计文本**，只给增量会只剩最后一段。
    const paras = (answer || '').split(/\n{2,}/)
    let acc = ''
    for (const p of paras) {
      if (!p.trim()) continue
      acc += p.trim() + '\n\n'
      yield { content: [{ type: 'text', text: acc }] }
      await new Promise((r) => setTimeout(r, 80))
    }
    if ((answer || '').trim() === '') {
      yield { content: [{ type: 'text', text: '(空回复)' }] }
    }
  },
}
