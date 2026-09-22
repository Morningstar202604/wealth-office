// 用 playwright-core 驱动：打开页面 → 自动提问 → 等交付完成 → 截图
const { chromium } = require('playwright-core')

const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8787/'
const QUESTION = process.argv[2] || '我这个月的钱都花到哪了？顺便看看我的组合有没有风险'
const OUT = process.argv[3] || 'shot.png'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1050 },
    colorScheme: 'dark',
    deviceScaleFactor: 1,
  })
  page.on('console', (m) => console.log('  [console]', m.type(), m.text()))
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

  const target = `${URL}?q=${encodeURIComponent(QUESTION)}`
  console.log('  打开:', target)
  await page.goto(target, { waitUntil: 'domcontentloaded' })

  // 等"团队汇报"卡片出现（= 流水线跑完并交付）
  await page.waitForSelector('.bubble-assistant', { timeout: 150000 })
  console.log('  [OK] 交付卡片已出现')
  await page.waitForTimeout(1200)

  const state = await page.evaluate(() => ({
    agents: [...document.querySelectorAll('.agent')].map((el) => ({
      label: el.querySelector('.agent-label')?.textContent,
      state: el.querySelector('.agent-state')?.textContent,
    })),
    events: document.querySelectorAll('.ev').length,
    level: document.querySelector('.level')?.textContent || '',
    hasAnswer: !!document.querySelector('.bubble-text'),
  }))
  console.log('  流水线状态:', JSON.stringify(state, null, 0))

  await page.screenshot({ path: OUT, fullPage: false })
  console.log('  截图已保存:', OUT)
  await browser.close()
})().catch((e) => { console.error('  失败:', e.message); process.exit(1) })
