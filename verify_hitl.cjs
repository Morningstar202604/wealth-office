// HITL 端到端验证（HTTP 层）：
//  1) L2 问答 → confirm_required（不含 final）
//  2) /api/resume approved=true  → 交付建议级汇报并归档
//  3) 再一轮 → approved=false    → 交付"已扣留"文案并归档
//  4) 定时晨报：手动生成 → /api/reports 可见；/api/scheduler 已启用
const BASE = 'http://127.0.0.1:8787'

const j = async (url, opts) => {
  const r = await fetch(BASE + url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error(`${opts?.method || 'GET'} ${url} -> HTTP ${r.status}`)
  return r.json()
}

async function sse(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) throw new Error(`${url} -> HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  let final = null
  let confirm = null
  let error = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''
    for (const c of chunks) {
      const line = c.replace(/^data:\s*/, '').trim()
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (e.type === 'event') events.push(e)
        else if (e.type === 'final') final = e
        else if (e.type === 'confirm_required') confirm = e
        else if (e.type === 'error') error = e.message
      } catch {}
    }
  }
  return { events, final, confirm, error }
}

const historyCount = async () => (await j('/api/history?limit=100')).runs.length

;(async () => {
  const fails = []
  const ok = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  |  ' + detail : ''}`)
    if (!cond) fails.push(label)
  }

  // ---- 1) 第一轮：应暂停在人审闸门 ----
  const before = await historyCount()
  const r1 = await sse('/api/ask', { question: '帮我看看有哪些风险', thread_id: 'hitl_verify' })
  ok('第一轮无 error', !r1.error, r1.error || '')
  ok('触发 confirm_required', !!r1.confirm,
     r1.confirm ? `level=${r1.confirm.level} flags=${(r1.confirm.flags || []).length} ckpt=${r1.confirm.ckpt_id.slice(0, 8)}` : 'none')
  ok('闸门流里没有 final（确实暂停了）', !r1.final)
  ok('confirm 带预览与决策所需 id', !!(r1.confirm && r1.confirm.ckpt_id && r1.confirm.thread_id))
  ok('闸门阶段不归档', (await historyCount()) === before)

  // ---- 2) 批准 → 交付 ----
  const r2 = await sse('/api/resume', {
    ckpt_id: r1.confirm.ckpt_id, thread_id: r1.confirm.thread_id, approved: true,
  })
  ok('批准续跑无 error', !r2.error, r2.error || '')
  ok('批准后交付 final', !!r2.final, r2.final ? `level=${r2.final.level}` : 'none')
  ok('交付的是建议级（非扣留）', r2.final && r2.final.level === 'L2 建议（需人审）',
     r2.final ? r2.final.level : '')
  ok('交付文本非空且非扣留文案', !!r2.final && r2.final.answer.length > 20 && !r2.final.answer.includes('扣留，内容未交付'))
  ok('批准轮归档 +1', (await historyCount()) === before + 1)

  // ---- 3) 第二轮：扣留 ----
  const r3 = await sse('/api/ask', { question: '我的组合现在什么情况？', thread_id: 'hitl_verify' })
  ok('第二轮同样触发闸门', !!r3.confirm)
  const r4 = await sse('/api/resume', {
    ckpt_id: r3.confirm.ckpt_id, thread_id: r3.confirm.thread_id, approved: false,
  })
  ok('扣留续跑无 error', !r4.error, r4.error || '')
  ok('扣留后 final 为已扣留', !!r4.final && r4.final.level === 'L2 已扣留',
     r4.final ? r4.final.level : '')
  ok('扣留文案不含实质汇报', !!r4.final && r4.final.answer.includes('扣留'))
  ok('扣留轮也归档 +1', (await historyCount()) === before + 2)

  // ---- 4) 定时晨报 ----
  const gen = await j('/api/reports/generate', { method: 'POST' })
  ok('晨报手动生成成功', gen.ok === true && (gen.answer || '').length > 20, `level=${gen.level}`)
  const reps = await j('/api/reports?limit=10')
  ok('晨报已归档可查', (reps.reports || []).length >= 1, `reports=${(reps.reports || []).length}`)
  const sch = await j('/api/scheduler')
  ok('后台调度器已启用', sch.enabled === true,
     `interval=${sch.interval_minutes}min next=${sch.next_run_at}`)

  console.log('\n' + (fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL PASS'))
  process.exit(fails.length ? 1 : 0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
