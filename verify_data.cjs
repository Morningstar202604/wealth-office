// 验证「真实数据源」：改持仓 → agent 读的确实是 SQLite 组合库（不是硬编码常量），
// 并验证本轮问答被持久化到历史。断言落在结构化 artifact 上（不依赖模型文案）。
const BASE = 'http://127.0.0.1:8787'

const SEED = [
  { symbol: '600519', name: '贵州茅台', kind: '股票', industry: '白酒', shares: 100, cost: 1680, last: 1521 },
  { symbol: '510300', name: '沪深300ETF', kind: 'ETF', industry: '宽基指数', shares: 8000, cost: 3.85, last: 4.06 },
  { symbol: '110011', name: '易方达中小盘混合', kind: '基金', industry: '主动权益', shares: 12000, cost: 4.1, last: 3.58 },
  { symbol: 'CASH', name: '活期现金', kind: '现金', industry: '现金', shares: 1, cost: 46200, last: 46200 },
]

// 已知答案的组合：TEST 5000股 成本10 现价20 → 市值 100,000；现金 10,000 → 总市值 110,000
// TEST 占比 90.9% → 必然突破 40% 单一持仓阈值
const MUTANT = [
  { symbol: 'TEST', name: '测试标的', kind: '股票', industry: '测试', shares: 5000, cost: 10, last: 20 },
  { symbol: 'CASH', name: '活期现金', kind: '现金', industry: '现金', shares: 1, cost: 10000, last: 10000 },
]
const EXPECT_MV = 110000

const j = async (url, opts) => {
  const r = await fetch(BASE + url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error(`${opts?.method || 'GET'} ${url} -> HTTP ${r.status}`)
  return r.json()
}

async function streamAsk(question) {
  const res = await fetch(BASE + '/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error(`/api/ask -> HTTP ${res.status}`)
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

async function streamResume(ckpt_id, thread_id, approved) {
  const res = await fetch(BASE + '/api/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ckpt_id, thread_id, approved }),
  })
  if (!res.ok) throw new Error(`/api/resume -> HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  let final = null
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
        else if (e.type === 'error') error = e.message
      } catch {}
    }
  }
  return { events, final, error }
}

function historyCount() {
  return j('/api/history?limit=100').then((d) => (d.runs || []).length)
}

;(async () => {
  const fails = []
  const ok = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  |  ' + detail : ''}`)
    if (!cond) fails.push(label)
  }

  const before = await historyCount()
  const seedBefore = await j('/api/portfolio')
  const seedMV = seedBefore.positions.reduce((s, p) => s + p.shares * p.last, 0)

  // 1) 写入已知组合，读回
  await j('/api/portfolio/positions', { method: 'PUT', body: JSON.stringify({ positions: MUTANT }) })
  const after = await j('/api/portfolio')
  const mutMV = after.positions.reduce((s, p) => s + p.shares * p.last, 0)
  ok('PUT 后 /api/portfolio 返回新持仓', after.positions.length === 2 && after.positions.some((p) => p.symbol === 'TEST'),
     `positions=${after.positions.length}, 总市值=${mutMV}`)
  ok('读回总市值 == 期望 110,000', mutMV === EXPECT_MV, `actual=${mutMV} (seed时=${seedMV})`)

  // 2) 跑一轮组合诊断，断言 agent 用的是新组合
  const { events, final, confirm, error } = await streamAsk('我的组合现在什么情况？')
  ok('问答无 error 事件', !error, error || '')
  // L2 建议级会被 HITL 闸门拦在 confirm_required；此时需 resume 才出 final + 归档。
  // 本脚本只关心"真实数据源 + 归档"两件事，故无论是否命中闸门，都续跑完成。
  let finalEvt = final
  if (!finalEvt && confirm) {
    const r = await streamResume(confirm.ckpt_id, confirm.thread_id, true)
    finalEvt = r.final
  }
  ok('产出 final', !!finalEvt, finalEvt ? `level=${finalEvt.level} route=${finalEvt.route}` : (confirm ? '确认存在但未续跑' : 'none'))

  const marketEvt = events.find((e) => e.agent === 'market' && e.phase === 'done')
  const gotMV = marketEvt?.artifact?.total_market_value
  ok('market agent 读到新总市值 == 110,000', gotMV === EXPECT_MV,
     `artifact.total_market_value=${gotMV} (若为 ${seedMV} 说明读了硬编码种子)`)

  const riskEvt = events.find((e) => e.agent === 'risk' && e.phase === 'done')
  const flags = riskEvt?.artifact?.flags || []
  ok('风控官因测试组合触发集中度告警', flags.some((f) => f.code === 'CONCENTRATION'),
     `flags=${flags.map((f) => f.code).join(',') || '无'}`)

  // 3) 本轮已归档
  const before2 = await historyCount()
  ok('本轮写入历史 (runs +1)', before2 === before + 1, `${before} -> ${before2}`)

  // 4) 恢复种子数据
  await j('/api/portfolio/reset', { method: 'POST' })
  const restored = await j('/api/portfolio')
  ok('reset 后回到种子持仓', restored.positions.length === 4 && !restored.positions.some((p) => p.symbol === 'TEST'),
     `positions=${restored.positions.length}`)

  console.log('\n' + (fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL PASS'))
  process.exit(fails.length ? 1 : 0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
