// 新前端截图：落地页 / 运行中 / HITL 人审闸门 / 完整交付；并捕获运行时报错
// 流程：点预设 → 专家并行 → L2 触发 confirm_required（前端出人审卡）→ 批准 → 文书成文交付
// 注意：HistorySection 渲染在预设之上，② 必须限定 .rounded-full；完成信号只认现场"团队汇报"卡。
const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8787/'
const DIR = 'C:/Users/X1882/WorkBuddy/2026-09-19-16-28-43/'
const OUT1 = DIR + 'wealth-office-mvp-11.png'
const OUT2 = DIR + 'wealth-office-mvp-12.png'
const OUT4 = DIR + 'wealth-office-mvp-15.png' // 人审闸门
const OUT5 = DIR + 'wealth-office-mvp-16.png' // 设置面板
const OUT3 = DIR + 'wealth-office-mvp-13.png'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1050 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

  console.log('① 落地页')
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: OUT1 })
  console.log('   saved', OUT1)

  console.log('①b 设置面板')
  await page.click('button[title="设置"]')
  await page.waitForSelector('text=账本假设', { timeout: 10000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT5 })
  console.log('   saved', OUT5)
  await page.mouse.click(20, 500)
  await page.waitForTimeout(400)

  console.log('② 点击预设（.rounded-full，避开历史行按钮）')
  await page.click('button.rounded-full:has-text("帮我看看有哪些风险")')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: OUT2 })
  console.log('   saved', OUT2)

  console.log('③ 等 HITL 人审闸门（批准交付按钮出现）')
  await page.waitForSelector('button:has-text("批准交付")', { timeout: 150000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT4 })
  console.log('   saved', OUT4)

  console.log('④ 批准 → 等完整交付（现场卡内部出现"模型调用"）')
  await page.click('button:has-text("批准交付")')
  await page.waitForFunction(() => {
    const isTitle = (e) => e.textContent && e.textContent.trim() === '团队汇报'
    const spans = [...document.querySelectorAll('span')].filter(isTitle)
    for (const h of spans) {
      let el = h
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement
        if (!el) break
        const reps = [...el.querySelectorAll('span')].filter(isTitle).length
        if ((el.innerText || '').includes('模型调用') && reps === 1) return true
      }
    }
    return false
  }, undefined, { timeout: 150000 })
  await page.waitForTimeout(1500)
  const state = await page.evaluate(() => ({
    hasReport: document.body.innerText.includes('团队汇报'),
    hasWorkbench: document.body.innerText.includes('数据工作台'),
    hasSummary: document.body.innerText.includes('总市值'),
    hasTable: document.body.innerText.includes('持仓明细'),
    hasStepper: document.body.innerText.includes('协作过程'),
    hasFollowUps: document.body.innerText.includes('集中度降到阈值'),
    historyLabel: (document.body.innerText.match(/历史记录 · (\d+) 轮/) || [])[1] || '0',
    hasGate: document.body.innerText.includes('建议级汇报待人审'),
  }))
  console.log('   状态:', JSON.stringify(state))
  await page.screenshot({ path: OUT3 })
  console.log('   saved', OUT3)

  console.log('=== 运行时错误 ===')
  console.log(errors.length ? errors.join('\n') : '  [无]')
  await browser.close()
  process.exit(errors.length ? 2 : 0)
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })
