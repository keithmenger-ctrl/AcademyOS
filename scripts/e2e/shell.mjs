// Generic-shell core flows only: sign in/out, org isolation, athletes list/add/edit, CSV import with blank
// sport/position/school columns. Needs no seed data, no optional feature, and no Stripe/Anthropic/SMTP.
// Run via `npm run test:e2e:shell` (brings up the whole stack), or against any running app with BASE_URL set.
import { launch, check, done, isBlocked, BASE, PASSWORD } from './lib.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const stamp = Date.now().toString(36)
const pathOf = (page) => new URL(page.url()).pathname
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'academyos-e2e-'))
const csvFile = (name, rows) => { const f = path.join(tmp, name); fs.writeFileSync(f, rows.join('\r\n')); return f }
// Console noise from deliberately-404ing navigations is expected; anything else is a real error.
const realErrors = (errors) => errors.filter((e) => !/Failed to load resource/.test(e))

async function signup(page, org, email) {
  await page.goto(`${BASE}/signup`)
  await page.fill('input[name=orgName]', org)
  await page.fill('input[name=fullName]', 'Test Owner')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL('**/dashboard', { timeout: 30000 }), page.click('button[type=submit]')])
}

async function signIn(page, email, password = PASSWORD) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', password)
  await page.click('button[type=submit]')
}

async function addAthlete(page, first, last, extra = {}) {
  await page.goto(`${BASE}/athletes/new`)
  await page.fill('input[name=first_name]', first)
  await page.fill('input[name=last_name]', last)
  for (const [name, value] of Object.entries(extra)) await page.fill(`input[name=${name}]`, value)
  await Promise.all([page.waitForURL(/\/athletes\/[0-9a-f-]{36}$/, { timeout: 30000 }), page.click('button:text("Add athlete")')])
  return pathOf(page).split('/').pop()
}

async function previewCsv(page, file) {
  await page.goto(`${BASE}/athletes/import`)
  await page.setInputFiles('input[type=file]', file)
  await page.click('button:text("Check file")')
  await page.waitForSelector('table')
  return page.innerText('main')
}

const rows = async (page) => page.locator('tbody tr').count()
const athleteListText = async (page, q = '') => { await page.goto(`${BASE}/athletes${q}`); return page.innerText('main') }
const sportOptions = async (page) => {
  await page.goto(`${BASE}/athletes/new`)
  return page.locator('select[name=sport_id] option').allTextContents()
}

const orgA = `Alpha Athletics ${stamp}`
const orgB = `Bravo Training ${stamp}`
const emailA = `owner-a-${stamp}@example.test`
const emailB = `owner-b-${stamp}@example.test`

const a = await launch()
const b = await launch()

// ---- the plain shell: optional features are off ------------------------------------------------------------
{
  await a.page.goto(`${BASE}/signup`)
  check('signup has no demo-data checkbox', (await a.page.locator('input[name=demo]').count()) === 0)
  await a.page.goto(`${BASE}/dashboard`)
  check('signed-out /dashboard -> /login', pathOf(a.page) === '/login', pathOf(a.page))
}

// ---- sign up, sign out, sign in (org A) --------------------------------------------------------------------
await signup(a.page, orgA, emailA)
{
  check('signup lands on /dashboard', pathOf(a.page) === '/dashboard', pathOf(a.page))
  check('shell shows the new org name', (await a.page.textContent('aside')).includes(orgA))
  const nav = (await a.page.locator('aside nav a').allTextContents()).join('|')
  check('nav has no billing or assistant link while flags are off', !/billing|assistant/i.test(nav), nav)
  check('nav has the core links', ['Dashboard', 'Athletes', 'Programs', 'Schedule'].every((t) => nav.includes(t)), nav)

  await a.page.click('button[aria-label="Sign out"]')
  await a.page.waitForURL('**/login')
  await a.page.goto(`${BASE}/athletes`)
  check('after sign-out, /athletes -> /login', pathOf(a.page) === '/login', pathOf(a.page))

  await signIn(a.page, emailA, 'wrong-password')
  await a.page.waitForSelector('form [role=alert]')
  check('bad password shows an error and stays on /login', (await a.page.textContent('form [role=alert]')).includes('Incorrect') && pathOf(a.page) === '/login')

  await signIn(a.page, emailA)
  await a.page.waitForURL('**/dashboard', { timeout: 30000 })
  check('correct password signs in to /dashboard', pathOf(a.page) === '/dashboard')
}

// ---- athletes: empty state, add, list, search, edit (org A) ------------------------------------------------
const first = `Casey${stamp}`
let aId
{
  const t = await athleteListText(a.page)
  check('empty org shows the "No athletes yet" state', t.includes('No athletes yet') && (await rows(a.page)) === 0)

  aId = await addAthlete(a.page, first, 'Alvarez', { date_of_birth: '2012-05-17' })
  const p = await a.page.innerText('main')
  check('new athlete profile opens with the name', p.includes(`${first} Alvarez`))
  check('blank sport/position/school render no placeholder junk', !/\b(null|undefined)\b/.test(p), p.slice(0, 200))

  let t2 = await athleteListText(a.page)
  check('athlete appears in the list', t2.includes(`${first} Alvarez`) && (await rows(a.page)) === 1)
  check('list subtitle has no stray separators', !/·\s*·|·\s*$/m.test(await a.page.locator('tbody tr').first().innerText()))
  t2 = await athleteListText(a.page, `?q=${first.toLowerCase()}`)
  check('search finds the athlete case-insensitively', t2.includes(`${first} Alvarez`))
  t2 = await athleteListText(a.page, '?q=zzz-no-such-athlete')
  check('search with no match shows the filtered empty state', t2.includes('No athletes match those filters'))

  await a.page.goto(`${BASE}/athletes/${aId}/edit`)
  await a.page.fill('input[name=last_name]', 'Alvarez-Reyes')
  await a.page.fill('input[name=position]', 'Midfield')
  await a.page.fill('input[name=school_team]', 'Lincoln High')
  await a.page.selectOption('select[name=status]', 'trial')
  await a.page.click('button:text("Save changes")')
  await a.page.waitForURL(new RegExp(`/athletes/${aId}$`), { timeout: 30000 })
  const e = await a.page.innerText('main')
  check('edit saved: new last name, position and school shown', e.includes(`${first} Alvarez-Reyes`) && e.includes('Midfield') && e.includes('Lincoln High'), e.slice(0, 300))
  const list = await athleteListText(a.page)
  check('edit saved: list shows renamed athlete as Trial', list.includes(`${first} Alvarez-Reyes`) && /trial/i.test(list))
  check('edit saved: position appears in the list subtitle', list.includes('Midfield'))

  await a.page.goto(`${BASE}/athletes/new`)
  await a.page.fill('input[name=first_name]', 'Only')
  await a.page.fill('input[name=last_name]', 'Invalid')
  await a.page.fill('input[name=guardian_name]', 'Some Parent')
  await a.page.fill('input[name=guardian_email]', 'not-an-email')
  await a.page.evaluate(() => document.querySelector('input[name=guardian_email]').setAttribute('type', 'text'))
  await a.page.click('button:text("Add athlete")')
  await a.page.waitForSelector('form [role=alert]')
  check('invalid parent email is rejected with a message', (await a.page.textContent('form [role=alert]')).includes('Parent email is invalid') && pathOf(a.page) === '/athletes/new')
}

// ---- org isolation (org B is a different user in a different browser context) -------------------------------
await signup(b.page, orgB, emailB)
const bFirst = `Blake${stamp}`
let bId
{
  check('org B sees its own org name, not org A', (await b.page.textContent('aside')).includes(orgB) && !(await b.page.innerText('body')).includes(orgA))
  const t = await athleteListText(b.page)
  check("org B's athlete list is empty (A's athlete is invisible)", t.includes('No athletes yet') && !t.includes(first))

  bId = await addAthlete(b.page, bFirst, 'Baptiste')
  const tb = await athleteListText(b.page)
  check('org B sees only its own athlete', tb.includes(`${bFirst} Baptiste`) && !tb.includes(first) && (await rows(b.page)) === 1)
  const tbSearch = await athleteListText(b.page, `?q=${first}`)
  check("searching for A's athlete from B finds nothing", !tbSearch.includes(`${first} Alvarez`))

  await b.page.goto(`${BASE}/athletes/${aId}`)
  check("B opening A's athlete profile by id is blocked", await isBlocked(b.page, [first, 'Alvarez']), pathOf(b.page))
  await b.page.goto(`${BASE}/athletes/${aId}/edit`)
  check("B opening A's athlete edit form by id is blocked", await isBlocked(b.page, [first, 'Alvarez']), pathOf(b.page))

  await a.page.goto(`${BASE}/athletes/${bId}`)
  check("A opening B's athlete profile by id is blocked", await isBlocked(a.page, [bFirst, 'Baptiste']), pathOf(a.page))
  const ta = await athleteListText(a.page)
  check("org A's list never shows B's athlete", !ta.includes(bFirst))
}

// ---- CSV import with blank sport / position / school columns (org A) ---------------------------------------
const importErrorsBefore = a.errors.length
{
  await a.page.goto(`${BASE}/athletes/import`)
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('a:text("Download the template")')])
  const templatePath = await dl.path()
  const tpl = fs.readFileSync(templatePath, 'utf8')
  const [header, example] = tpl.trim().split('\n')
  check('template has the Sport, Position and School/team columns', ['Sport', 'Position', 'School/team'].every((h) => header.split(',').includes(h)), header)
  const cols = header.split(',')
  const cell = (h) => example.split(',')[cols.indexOf(h)]
  check('template example row leaves sport, position and school blank', cell('Sport') === '' && cell('Position') === '' && cell('School/team') === '', example)

  const tplCopy = path.join(tmp, 'template.csv')
  fs.copyFileSync(templatePath, tplCopy)
  const pre = await previewCsv(a.page, tplCopy)
  check('the untouched template previews as 1 ready row', pre.includes('1 ready') && pre.includes('Jordan Rivera') && !pre.includes('with errors'), pre.slice(0, 300))
  const before = await (async () => { await a.page.goto(`${BASE}/athletes`); return rows(a.page) })()
  await previewCsv(a.page, tplCopy)
  await a.page.click('button:text("Import 1 athlete")')
  await a.page.waitForSelector('text=Imported 1 athlete')
  check('template row imports', (await a.page.innerText('main')).includes('Imported 1 athlete'))
  await a.page.goto(`${BASE}/athletes?q=Rivera`)
  const jordan = await a.page.locator('tbody tr').first().innerText()
  check('imported athlete shows with no sport/position junk', (await rows(a.page)) === 1 && jordan.includes('Jordan Rivera') && !/\b(null|undefined)\b/.test(jordan) && !/·\s*·|·\s*$/m.test(jordan.split('\n')[1] ?? ''), jordan)
  await a.page.click('tbody tr a')
  await a.page.waitForURL(/\/athletes\/[0-9a-f-]{36}$/)
  const prof = await a.page.innerText('main')
  check('imported athlete profile: parent linked, no placeholder junk', prof.includes('Alex Rivera') && prof.includes('alex.rivera@example.com') && !/\b(null|undefined)\b/.test(prof))
  check('blank sport column created no sport', (await sportOptions(a.page)).join('|') === '—')

  const mixed = csvFile('mixed.csv', [
    'First name,Last name,Date of birth,Sport,Position,School/team,Status,Program,Level,Join date,Parent name,Parent email,Parent phone,Notes',
    `Dana${stamp},Ng,2010-03-04,Soccer,Winger,Roosevelt,active,,,,,,,`,
    `Eli${stamp},Park,2011-07-08,,,,trial,,,,,,,`,
    `Fay${stamp},Quinn,31/02/2011,,,,,,,,,,,`,
    `Gus${stamp},Roe,2012-09-10,,Goalkeeper,,,,,,,,,`,
  ])
  const m = await previewCsv(a.page, mixed)
  check('mixed file: 3 ready, 1 bad date reported per row', m.includes('3 ready') && m.includes('1 with errors') && m.includes("31/02/2011\" isn't a date"), m.slice(0, 400))
  await a.page.click('button:text("Import 3 athletes")')
  await a.page.waitForSelector('text=Imported 3 athletes')
  check('mixed file: 3 imported, bad row skipped', (await a.page.innerText('main')).includes('1 rows were skipped'))
  const after = await athleteListText(a.page)
  check('list grew by 4 in total', (await rows(a.page)) === before + 4, `${before} -> ${await rows(a.page)}`)
  check('sport + position from the CSV show in the list; blank ones do not', after.includes('Soccer · Winger') && after.includes('Goalkeeper') && !/Eli\w+ Park\s*\n[^\n]*\b(null|undefined)\b/.test(after))
  check('bad-date row was not imported', !after.includes(`Fay${stamp}`))
  check('only the sport that had a value was created', (await sportOptions(a.page)).join('|') === '—|Soccer')

  const again = await previewCsv(a.page, mixed)
  check('re-importing the same file is idempotent (0 ready, existing skipped)', again.includes('0 ready') && again.includes('already exist'), again.slice(0, 300))
  check('no console errors during import', realErrors(a.errors.slice(importErrorsBefore)).length === 0, realErrors(a.errors.slice(importErrorsBefore)).join(' | ').slice(0, 300))
}

// ---- import is org-scoped: B can import the same names, and A's sport is not visible to B -----------------
{
  const pre = await previewCsv(b.page, tplCopyPath())
  check("org B's preview does not treat A's athletes as duplicates", pre.includes('1 ready') && !pre.includes('already exist'), pre.slice(0, 300))
  await b.page.click('button:text("Import 1 athlete")')
  await b.page.waitForSelector('text=Imported 1 athlete')
  const tb = await athleteListText(b.page)
  check('org B now has Jordan Rivera and its own athlete only', tb.includes('Jordan Rivera') && tb.includes(`${bFirst} Baptiste`) && !tb.includes(`Dana${stamp}`) && (await rows(b.page)) === 2)
  check("A's sport is not offered to org B", (await sportOptions(b.page)).join('|') === '—')
  const ta = await athleteListText(a.page, '?q=Rivera')
  check("A still has exactly one Jordan Rivera (B's import did not touch it)", (await rows(a.page)) === 1 && ta.includes('Jordan Rivera'))
}

// ---- optional features really are absent --------------------------------------------------------------------
{
  for (const route of ['/billing', '/assistant']) {
    await a.page.goto(`${BASE}${route}`)
    const body = await a.page.innerText('body')
    check(`${route} is not found while its flag is off`, body.includes("We couldn't find that"), pathOf(a.page))
  }
  check('no console errors on the happy path (org A)', realErrors(a.errors).length === 0, realErrors(a.errors).join(' | ').slice(0, 300))
  check('no console errors on the happy path (org B)', realErrors(b.errors).length === 0, realErrors(b.errors).join(' | ').slice(0, 300))
}

await a.browser.close()
await b.browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
done()

function tplCopyPath() { return path.join(tmp, 'template.csv') }
