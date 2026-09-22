// HITL 决策闸门：adapter 在 confirm_required 后挂起等待，UI 点击批准/扣留后放行。
// 单槽位即可：线程内问答是串行的，同一时刻至多一个人审在等待。

type Decision = { approved: boolean }

let current: ((d: Decision) => void) | null = null

/** adapter 调用：挂起直到用户做出决策（或 abort 被当作扣留）。 */
export function waitDecision(): Promise<Decision> {
  return new Promise((resolve) => {
    current = resolve
  })
}

/** UI 调用：用户点击批准 / 扣留。 */
export function resolveDecision(approved: boolean): void {
  const w = current
  current = null
  w?.({ approved })
}

/** abort 时把等待中的决策按"扣留"放行，避免 adapter 永久挂起。 */
export function abortPending(): void {
  resolveDecision(false)
}
