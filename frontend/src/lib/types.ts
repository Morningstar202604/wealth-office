// 后端契约（与 backend/app/main.py、agents.py 对齐）

export interface AgentInfo {
  id: string
  label: string
  role: string
  tone: string
}

export interface RosterMeta {
  agents: AgentInfo[]
  max_steps: number
  disclaimer: string
  source?: SourceMeta
}

/** 数据来源标注（L1 洞察必须带来源） */
export interface SourceMeta {
  portfolio: string
  ledger: string
  quotes: string
  seeded: boolean
}

/** 跨会话运行历史（后端 GET /api/history） */
export interface HistoryRun {
  id: number
  thread_id: string
  question: string
  answer: string
  level: string
  route: string
  route_reason: string
  llm_calls: number
  llm_fallbacks: number
  created_at: string
  trace?: unknown[]
}

export interface HealthMeta {
  ok: boolean
  llm_configured: boolean
  model: string
  endpoint: string
}

export type EventPhase = 'start' | 'done'

/** 后端逐事件推送的"某 agent 在干活"过程事件 */
export interface AgentProcessEvent {
  type: 'event'
  agent: string
  label?: string
  phase: EventPhase
  detail?: string
  artifact?: unknown
}

export interface FinalMeta {
  answer: string
  level: string
  route: string
  route_reason: string
  llm_calls: number
  llm_fallbacks: number
}

export interface StreamError {
  type: 'error'
  message: string
}

/** HITL 人审闸门：L2 建议级交付前等用户批准/扣留 */
export interface ConfirmPayload {
  ckpt_id: string
  thread_id: string
  level: string
  flags: { level: string; code: string; text: string }[]
  preview: string
  question?: string
}

/** 后端 SSE 可能推送的全部事件 */
export type StreamEvent =
  | { type: 'start'; question: string }
  | AgentProcessEvent
  | { type: 'final'; answer: string; level: string; route: string; route_reason: string; llm_calls: number; llm_fallbacks: number }
  | ({ type: 'confirm_required' } & ConfirmPayload)
  | { type: 'resume_started'; ckpt_id: string; approved: boolean }
  | StreamError
  | { type: 'done' }

export type AgentPhase = 'idle' | 'running' | 'done'
