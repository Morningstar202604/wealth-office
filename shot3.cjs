// 多轮隔离验证 v2：等「每张卡片都各自完成」后再判定，且 DOM 爬升不越过卡片边界
const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8787/'
const OUT = 'C:/Users/X1882/WorkBuddy/2026-09-19-16-28-43/wealth-office-mvp-14.png'

// 在页面里执行：收集「已完成的团队汇报卡」文本；爬升时要求候选节点只含 1 个"团队汇报"标题
const PROBE = `(() => {
  const spans = [...document.querySelectorAll('span')].filter(e => e.textContent && e.textContent.trim() === '团队汇报')
  const cards = []
  for (const h of spans) {
    let el = h
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement
      if (!el) break
      const reps = [...el.querySelectorAll('span')].filter(e => e.textContent && e.textContent.trim() === '团队汇报').length
      if ((el.innerText || '').includes('模型调用') && reps === 1) { cards.push(el.innerText.replace(/\\s+/g, ' ').trim()); break }
    }
  }
  const routes = cards.map(c => (c.match(/派给：(\\S+)/) || [])[1] || '?')
  const users = [...document.querySelectorAll('div')].filter(e => e.className && String(e.className).includes('rounded-3xl') && String(e.className).includes('bg-muted')).map(e => e.innerText.trim())
  return { n: cards.length, routes, users, cards }
})()`

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 2100 }, colorScheme: 'light', deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // HITL：每轮 L2 都会在人审闸门暂停，等"批准交付"按钮出现后点掉，卡片才会完成
  const approveGate = async (label) => {
    try {
      await page.waitForSelector('button:has-text("批准交付")', { timeout: 150000 })
      await page.click('button:has-text("批准交付")')
      console.log(`  [${label}] 人审已批准`)
    } catch {
      // 没出现闸门（如该轮恰好 L1）则继续
      console.log(`  [${label}] 未出现人审闸门，继续`)
    }
  }

  console.log('① 第 1 轮：点预设「我这个月的钱都花到哪了？」')
  await page.click('button.rounded-full:has-text("我这个月的钱都花到哪了？")')
  await approveGate('第1轮')
  await page.waitForFunction((p) => eval(p).n >= 1, PROBE, { timeout: 150000 })
  await page.waitForTimeout(800)
  const r1 = await page.evaluate(PROBE)
  console.log('  完成卡片数:', r1.n, '| 路由:', r1.routes.join(','), '| 用户气泡:', r1.users.join(' / '))

  console.log('② 第 2 轮：输入「我的组合现在什么情况？」')
  await page.fill('textarea', '我的组合现在什么情况？')
  await page.keyboard.press('Enter')
  await approveGate('第2轮')
  await page.waitForFunction((p) => eval(p).n >= 2, PROBE, { timeout: 150000 })
  await page.waitForTimeout(1200)
  const r2 = await page.evaluate(PROBE)
  console.log('  完成卡片数:', r2.n, '| 路由:', r2.routes.join(','), '| 用户气泡:', r2.users.join(' / '))

  const firstUnchanged = r2.cards[0] === r1.cards[0]
  const routesDiffer = r2.routes.length >= 2 && r2.routes[0] !== r2.routes[1]
  const usersOk = r2.users.length === 2 && r2.users[1].includes('我的组合')
  console.log('  判定 → 首卡未被覆写:', firstUnchanged, '| 两卡路由不同:', routesDiffer, '| 第2轮问题正确:', usersOk)

  await page.screenshot({ path: OUT })
  console.log('  saved', OUT)
  console.log('=== 运行时错误 ===')
  console.log(errors.length ? errors.join('\n') : '  [无]')
  await browser.close()
  process.exit(errors.length ? 2 : firstUnchanged && routesDiffer && usersOk ? 0 : 3)
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })
