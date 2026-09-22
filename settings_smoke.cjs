// 设置面板冒烟：齿轮打开 → 改"月收入"→ 保存 → 后端确认 → 还原
const { chromium } = require('playwright-core')
const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8787/'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, colorScheme: 'light' })
  const errors = []
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  console.log('① 打开设置')
  await page.click('button[title="设置"]')
  await page.waitForSelector('text=账本假设', { timeout: 10000 })
  console.log('   面板已打开')

  console.log('② 修改月收入 24800 → 26000 并保存')
  const input = page.locator('input[type="number"]').first()
  await input.fill('26000')
  await page.click('button:has-text("保存")')
  await page.waitForSelector('text=已保存', { timeout: 10000 })
  console.log('   已保存提示出现')

  console.log('③ 后端确认写入')
  const v = await page.evaluate(async () => {
    const d = await fetch('/api/settings').then((r) => r.json())
    return d.settings.monthly_income
  })
  console.log('   monthly_income =', v)

  console.log('④ 点遮罩关闭面板')
  await page.mouse.click(20, 500)
  await page.waitForTimeout(400)
  const panelGone = (await page.locator('text=账本假设').count()) === 0
  console.log('   面板已关闭:', panelGone)
  await browser.close()

  // 还原演示默认值
  await fetch('http://127.0.0.1:8787/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { monthly_income: '24800' } }),
  })

  if (parseFloat(v) !== 26000) {
    console.error('FAIL: 设置未写入后端, actual =', v)
    process.exit(1)
  }
  if (!panelGone) { console.error('FAIL: 面板未能关闭'); process.exit(1) }
  console.log('SMOKE PASS（monthly_income 已还原 24800）')
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })
