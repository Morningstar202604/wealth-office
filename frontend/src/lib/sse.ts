// 后端 SSE 客户端：POST /api/ask 与 POST /api/resume，逐事件解析后回调给上层。
// 事件契约见 backend/app/main.py 与 agents.py。

import type { AgentProcessEvent, ConfirmPayload, FinalMeta, StreamEvent } from './types'

export interface StreamHandlers {
  onStart?: (question: string) => void
  onEvent?: (ev: AgentProcessEvent) => void
  onFinal?: (meta: FinalMeta) => void
  onConfirmRequired?: (p: ConfirmPayload) => void
  onError?: (message: string) => void
}

async function consume(res: Response, handlers: StreamHandlers): Promise<void> {
  if (!res.body) throw new Error('响应无内容流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.replace(/^data:\s*/, '').trim()
      if (!line) continue
      let evt: StreamEvent
      try {
        evt = JSON.parse(line)
      } catch {
        continue
      }
      route(evt, handlers)
    }
  }
}

export async function streamAsk(
  question: string,
  signal: AbortSignal,
  handlers: StreamHandlers,
  threadId?: string,
): Promise<void> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, thread_id: threadId || undefined }),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`后端返回 HTTP ${res.status}`)
  }
  await consume(res, handlers)
}

/** HITL 决策后续跑：后端从 interrupt 处恢复，续流 finalize 与 final。 */
export async function streamResume(
  p: { ckpt_id: string; thread_id: string; approved: boolean },
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch('/api/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`后端返回 HTTP ${res.status}`)
  }
  await consume(res, handlers)
}

function route(evt: StreamEvent, h: StreamHandlers) {
  switch (evt.type) {
    case 'start':
      h.onStart?.(evt.question)
      break
    case 'event':
      if (evt.agent) h.onEvent?.(evt)
      break
    case 'final':
      h.onFinal?.({
        answer: evt.answer,
        level: evt.level,
        route: evt.route,
        route_reason: evt.route_reason,
        llm_calls: evt.llm_calls,
        llm_fallbacks: evt.llm_fallbacks,
      })
      break
    case 'confirm_required':
      h.onConfirmRequired?.({
        ckpt_id: evt.ckpt_id,
        thread_id: evt.thread_id,
        level: evt.level,
        flags: evt.flags ?? [],
        preview: evt.preview ?? '',
        question: evt.question,
      })
      break
    case 'error':
      h.onError?.(evt.message)
      break
    default:
      break
  }
}
