// 排查：HITL 批准后，汇报正文是否真的进了 DOM（还是只有免责声明行）
const { chromium } = require('playwright-core')
const CHROME = 'C:/Users/X1882/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8787/'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1400 }, colorScheme: 'light' })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()) })

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.click('button.rounded-full:has-text("帮我看看有哪些风险")')
  await page.waitForSelector('button:has-text("批准交付")', { timeout: 150000 })
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
  await page.waitForTimeout(4000) // 等正文段落全部流完

  const info = await page.evaluate(() => {
    const isTitle = (e) => e.textContent && e.textContent.trim() === '团队汇报'
    const spans = [...document.querySelectorAll('span')].filter(isTitle)
    let card = null
    for (const h of spans) {
      let el = h
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement
        if (!el) break
        const reps = [...el.querySelectorAll('span')].filter(isTitle).length
        if ((el.innerText || '').includes('模型调用') && reps === 1) { card = el; break }
      }
      if (card) break
    }
    if (!card) return { found: false }
    // 找正文容器（含免责声明的那个 div）
    const bodyDiv = [...card.querySelectorAll('div')].find((d) => (d.innerText || '').includes('以上为基于'))
    return {
      found: true,
      cardText: card.innerText.replace(/\s+/g, ' ').slice(0, 400),
      bodyDivText: bodyDiv ? bodyDiv.innerText.replace(/\s+/g, ' ').slice(0, 400) : '(no body div)',
      bodyDivChildren: bodyDiv ? bodyDiv.children.length : -1,
      bodyDivHTMLHead: bodyDiv ? bodyDiv.innerHTML.slice(0, 300) : '',
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })
