// Tiny Playwright helpers for verifying the running app (dev server on :3000, local GoTrue + seeded Postgres).
import { chromium } from 'playwright-core'
import fs from 'node:fs'

export const BASE = process.env.BASE_URL || 'http://localhost:3000'
export const PASSWORD = 'academyos-demo'

// E2E_CHROMIUM_PATH wins; then the Linux sandbox's /opt/pw-browsers; otherwise Playwright's own installed Chromium
// (`npx playwright-core install chromium`).
const exe = () => {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  const dir = fs.existsSync(root) && fs.readdirSync(root).find((d) => /^chromium-\d+$/.test(d))
  return dir ? `${root}/${dir}/chrome-linux/chrome` : undefined
}

export async function launch(viewport = { width: 1280, height: 800 }) {
  const browser = await chromium.launch({ executablePath: exe(), args: ['--no-sandbox'] })
  // every page from any context (including extra contexts for a second user) waits for content to settle
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...a) => {
    const c = await newContext(...a)
    const newPage = c.newPage.bind(c)
    c.newPage = async (...b) => settleOnNavigation(await newPage(...b))
    return c
  }
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  return { browser, ctx, page, errors }
}

/**
 * Route-level loading skeletons (aria-busy) render while server content streams in, and client-side
 * navigations change the URL before the content arrives. Make navigation + reads wait until the page
 * has settled, so every suite reads real content rather than the skeleton.
 */
export function settleOnNavigation(page) {
  const settle = () =>
    page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30000 }).catch(() => {})
  for (const name of ['goto', 'reload', 'waitForURL']) {
    const orig = page[name].bind(page)
    page[name] = async (...args) => { const r = await orig(...args); await settle(); return r }
  }
  for (const name of ['innerText', 'textContent']) {
    const orig = page[name].bind(page)
    page[name] = async (...args) => { await settle(); return orig(...args) }
  }
  return page
}

export async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.click('button[type=submit]')])
}

let failures = 0
export function check(name, ok, extra = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${name}${!ok && extra ? ` (${extra})` : ''}`)
}
export const done = () => {
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
}

/**
 * A protected page must show the not-found screen and none of the protected content.
 * (With loading skeletons the response streams, so the HTTP status is 200; assert on what renders.)
 */
export async function isBlocked(page, forbidden = []) {
  const body = await page.innerText('body')
  const html = await page.content()
  return body.includes("We couldn't find that") && forbidden.every((t) => !body.includes(t) && !html.includes(t))
}
