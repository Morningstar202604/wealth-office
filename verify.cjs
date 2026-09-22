// 端到端验证：① 真实数据源（改持仓 → 分析跟着变）② 跨会话历史（刷新后仍在）
const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = 'http://127.0.0.1:8787'
const OUT = 'C:/Users/X1882/WorkBuddy/2026-09-19-16-28-43/wealth-office-mvp-15.png'
const OUT_HISTORY = 'C:/Users/X1882/WorkBuddy/2026-09-19-16-28-43/wealth-office-mvp-16.png'

const get = (p) => fetch(BASE + p).then((r) => r.json())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 从 Node 侧轮询历史条数（比在页面里 waitForFunction 可控且可观测）。 */
async function waitRuns(min, timeoutMs) {
  const t0 = Date.now()
  let runs = []
  while (Date.now() - t0 < timeoutMs) {
    runs = (await get('/api/history?limit=10')).runs || []
    if (runs.length >= min) return runs
    await sleep(1500)
  }
  return runs
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1500 },
    colorScheme: 'dark',
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

  // ---- ① 改持仓前 ----
  const pf0 = await get('/api/portfolio')
  console.log('① 改持仓前：positions =', pf0.positions.length, '| seeded =', pf0.source.seeded)
  pf0.positions.forEach((p) => console.log('   -', p.name, p.shares, '@', p.last))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT_HISTORY })
  console.log('   落地页 →', OUT_HISTORY)

  // ---- ② 第 1 轮 ----
  console.log('② 第 1 轮：点预设')
  await page.click('text=我这个月的钱都花到哪了？')
  await page.waitForFunction(() => document.body.innerText.includes('模型调用'), null, { timeout: 180000 })
  let runs = await waitRuns(1, 10000)
  console.log('   历史 =', runs.length, '| 第1轮', runs[0] && runs[0].level, '| 派给', runs[0] && runs[0].route)

  // ---- ③ 改成一组截然不同的持仓 ----
  const newPositions = [
    { symbol: '000001', name: '某单一成长股', kind: '股票', industry: '单一标的',
      shares: 50000, cost: 30.0, last: 18.5 },
    { symbol: 'CASH', name: '活期现金', kind: '现金', industry: '现金',
      shares: 1, cost: 20000.0, last: 20000.0 },
  ]
  const put = await page.request.put(BASE + '/api/portfolio/positions', { data: { positions: newPositions } })
  const pf1 = await get('/api/portfolio')
  console.log('③ PUT status =', put.status(), '→ 改后 positions =', pf1.positions.length, '| seeded =', pf1.source.seeded)
  pf1.positions.forEach((p) => console.log('   -', p.name, p.shares, '@', p.last))

  // ---- ④ 刷新 + 第 2 轮（用新持仓）----
  console.log('④ 刷新后第 2 轮（新持仓）')
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.fill('textarea', '我的组合现在什么情况？')
  await page.keyboard.press('Enter')

  runs = await waitRuns(2, 300000)
  // 等界面跑完（无"工作中"）再截图
  try {
    await page.waitForFunction(() => !document.body.innerText.includes('工作中'), null, { timeout: 120000 })
  } catch { /* 忽略：以历史条数为准 */ }
  await page.waitForTimeout(1500)

  console.log('   历史 =', runs.length)
  runs.forEach((r) => console.log('   *', r.level, '| 派给', r.route, '|', r.question,
    '| 事件', (r.trace || []).length, '条 |', r.created_at))
  const turn2 = runs[0] || {}
  console.log('\n--- 第2轮答案（须反映新组合） ---\n' + (turn2.answer || '(无)').slice(0, 700) + '\n')

  await page.screenshot({ path: OUT })
  console.log('   完整状态 →', OUT)

  const body = await page.evaluate(() => document.body.innerText)
  const a1 = (runs[1] || {}).answer || ''
  const a2 = turn2.answer || ''
  const checks = {
    '① 持仓已改成功（2 个、含单一成长股）':
      pf1.positions.length === 2 && pf1.positions[0].name.includes('单一'),
    '② 数据来源标注为本地组合库(SQLite)':
      !!pf1.source && pf1.source.portfolio.includes('本地组合库'),
    '③ 顶栏徽标翻成"你的数据"': body.includes('你的数据'),
    '④ 跨会话历史持久化 ≥2 轮': runs.length >= 2,
    '⑤ 刷新后历史区可见': body.includes('历史记录'),
    '⑥ 两轮派活不同（真按问题走）':
      !!turn2.route && !!(runs[1] || {}).route && turn2.route !== runs[1].route,
    '⑦ 第2轮派给行情分析员（走新组合）': turn2.route === 'market',
    '⑧ 过程事件已入库（审计链）': ((runs[1] || {}).trace || []).length > 0,
    '⑨ 第2轮答案反映新组合数字':
      ['945', '925', '97.9', '某单一成长股', '单一'].some((k) => a2.includes(k)),
    '⑩ 第2轮答案与第1轮不同': a1.length > 0 && a1 !== a2,
    '⑪ 无运行时错误': errors.length === 0,
  }

  console.log('\n=== 断言 ===')
  let ok = true
  for (const [k, v] of Object.entries(checks)) {
    console.log(v ? '  PASS' : '  FAIL', '|', k)
    if (!v) ok = false
  }
  if (errors.length) console.log('\n错误:\n' + errors.join('\n'))
  await browser.close()
  console.log('\n总判定:', ok ? 'ALL PASS' : 'HAS FAIL')
  process.exit(ok ? 0 : 3)
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })
