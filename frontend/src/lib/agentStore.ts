// 全局轻量 store：把后端 SSE 的"agent 过程事件"与最终元信息广播给 UI。
// 用 useSyncExternalStore 订阅。按 messageId 隔离，支持多轮对话互不串台。

import type { AgentInfo, AgentPhase, ConfirmPayload, FinalMeta, HealthMeta, HistoryRun, RosterMeta, SourceMeta } from './types'

export interface AgentStep {
  phase: AgentPhase
  label?: string
  detail?: string
  artifact?: unknown
  generated_by?: string
}

export interface ThreadSteps {
  agents: Record<string, AgentStep>
  order: string[]
  finalMeta: FinalMeta | null
  /** HITL：L2 建议级等人审时挂起的确认信息 */
  pendingConfirm: ConfirmPayload | null
}

export interface StoreState {
  byMessage: Record<string, ThreadSteps>
  currentMessageId: string | null
  roster: AgentInfo[]
  health: HealthMeta | null
  disclaimer: string
  maxSteps: number
  /** 数据来源标注（本地组合库 / 行情源 / 是否仍是种子数据） */
  source: SourceMeta | null
  /** 跨会话运行历史（后端持久化，刷新/重启后仍在） */
  history: HistoryRun[]
}

let state: StoreState = {
  byMessage: {},
  currentMessageId: null,
  roster: [],
  health: null,
  disclaimer: '基于组合与账本数据，不构成投资建议。',
  maxSteps: 0,
  source: null,
  history: [],
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

export function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export function getState(): StoreState {
  return state
}

function blankSteps(order: string[]): ThreadSteps {
  const agents: Record<string, AgentStep> = {}
  for (const id of order) agents[id] = { phase: 'idle' }
  return { agents, order, finalMeta: null, pendingConfirm: null }
}

/** 新一次回答开始：清掉该消息的步骤、设为当前。 */
export function initRun(messageId: string, order: string[]) {
  state = {
    ...state,
    currentMessageId: messageId,
    byMessage: { ...state.byMessage, [messageId]: blankSteps(order) },
  }
  emit()
}

export function setStep(messageId: string, agentId: string, patch: Partial<AgentStep>) {
  const prev = state.byMessage[messageId]
  if (!prev) return
  const cur = prev.agents[agentId] ?? { phase: 'idle' }
  state = {
    ...state,
    byMessage: {
      ...state.byMessage,
      [messageId]: { ...prev, agents: { ...prev.agents, [agentId]: { ...cur, ...patch } } },
    },
  }
  emit()
}

export function setFinal(messageId: string, meta: FinalMeta) {
  const prev = state.byMessage[messageId]
  if (!prev) return
  state = {
    ...state,
    byMessage: { ...state.byMessage, [messageId]: { ...prev, finalMeta: meta } },
  }
  emit()
}

/** HITL：L2 建议级到达人审闸门，挂起等用户决策。 */
export function setPendingConfirm(messageId: string, p: ConfirmPayload) {
  const prev = state.byMessage[messageId]
  if (!prev) return
  state = {
    ...state,
    byMessage: { ...state.byMessage, [messageId]: { ...prev, pendingConfirm: p } },
  }
  emit()
}

/** HITL：决策已做出，撤下确认卡。 */
export function clearPendingConfirm(messageId: string) {
  const prev = state.byMessage[messageId]
  if (!prev || !prev.pendingConfirm) return
  state = {
    ...state,
    byMessage: { ...state.byMessage, [messageId]: { ...prev, pendingConfirm: null } },
  }
  emit()
}

export function setRoster(meta: RosterMeta) {
  state = {
    ...state,
    roster: meta.agents,
    maxSteps: meta.max_steps,
    disclaimer: meta.disclaimer,
    source: meta.source ?? state.source,
  }
  emit()
}

export function setHealth(h: HealthMeta) {
  state = { ...state, health: h }
  emit()
}

export function setSource(s: SourceMeta | null) {
  state = { ...state, source: s }
  emit()
}

export function setHistory(runs: HistoryRun[]) {
  state = { ...state, history: runs }
  emit()
}

/** 新一轮问答完成后，把这轮插入历史顶部（无需重新请求接口）。 */
export function pushHistory(run: HistoryRun) {
  state = { ...state, history: [run, ...state.history].slice(0, 50) }
  emit()
}
