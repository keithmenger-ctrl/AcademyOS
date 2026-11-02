// Generic-shell core flows only: sign in/out, org isolation, athletes list/add/edit, CSV import with blank
// sport/position/school columns, programs -> levels -> curriculum, sessions + attendance, the coach "Today" view
// (invite, sign in as the coach, owner-only pages closed), and assessments -> athlete progress timeline.
// Needs no seed data, no optional feature, and no Stripe/Anthropic/SMTP.
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

// Put an athlete in a program + level through the edit form.
async function setProgram(page, athleteId, program, level) {
  await page.goto(`${BASE}/athletes/${athleteId}/edit`)
  await page.selectOption('select[name=program_id]', { label: program })
  await page.selectOption('select[name=level_id]', { label: level })
  await page.click('button:text("Save changes")')
  await page.waitForURL(new RegExp(`/athletes/${athleteId}$`), { timeout: 30000 })
}

// Run a server-action click and wait for its POST response, so a following reload cannot cut the request off.
const clickAndWait = (page, target) =>
  Promise.all([page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }), typeof target === 'string' ? page.click(target) : target.click()])
const seen = (page, text) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 30000 })

// One-tap attendance control for an athlete on a roster ("Present" | "Late" | "Absent").
const attSel = (athlete, label) => `[role=group][aria-label="Attendance for ${athlete}"] button[aria-label=${label}]`
const tap = (page, athlete, label) => clickAndWait(page, attSel(athlete, label))
const isOn = (page, athlete, label) => page.getAttribute(attSel(athlete, label), 'aria-pressed')
const attendanceSummary = async (page) => (await page.textContent('p[aria-live=polite]')).replace(/\s+/g, ' ').trim()

const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
const mainText = async (page) => (await page.innerText('main')).replace(/[ \t]+/g, ' ')

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

// ---- programs -> levels -> curriculum items (org A) --------------------------------------------------------
const progName = `Speed Lab ${stamp}`
const wk1 = `Acceleration ${stamp}`
const wk1Edited = `Acceleration Mechanics ${stamp}`
const wk2 = `Top Speed ${stamp}`
let programId, levelId
{
  await a.page.goto(`${BASE}/programs`)
  check('empty org shows the "No programs yet" state', (await mainText(a.page)).includes('No programs yet'))

  await a.page.goto(`${BASE}/programs/new`)
  await a.page.fill('input[name=name]', progName)
  await a.page.fill('textarea[name=description]', 'Build first-step quickness')
  await Promise.all([a.page.waitForURL(/\/programs\/[0-9a-f-]{36}$/, { timeout: 30000 }), a.page.click('button:text("Create program")')])
  programId = pathOf(a.page).split('/').pop()
  let t = await mainText(a.page)
  check('new program opens with name, description and an automatic Level 1', t.includes(progName) && t.includes('Build first-step quickness') && t.includes('Level 1') && /0\s*\/\s*20 athletes/.test(t), t.slice(0, 300))
  check('new program renders no placeholder junk', !/\b(null|undefined)\b/.test(t))

  const addLevel = 'form:has(button:text("Add level"))'
  await a.page.fill(`${addLevel} input[name=name]`, 'Advanced')
  await a.page.fill(`${addLevel} input[name=capacity]`, '8')
  await clickAndWait(a.page, `${addLevel} button:text("Add level")`)
  await a.page.reload()
  t = await mainText(a.page)
  check('added level appears with its capacity', t.includes('Advanced') && /0\s*\/\s*8 athletes/.test(t), t.slice(0, 300))

  const lvl1 = a.page.locator('details').first()
  await lvl1.locator('summary').click()
  await lvl1.locator('input[name=name]').fill('Foundation')
  await lvl1.locator('input[name=capacity]').fill('10')
  await clickAndWait(a.page, lvl1.locator('button:text-is("Save")'))
  await a.page.reload()
  const h3 = await a.page.locator('h3').allTextContents()
  t = await mainText(a.page)
  check('level edit saved: renamed, new capacity, order kept', h3.indexOf('Foundation') === 0 && h3.includes('Advanced') && !h3.includes('Level 1') && /0\s*\/\s*10 athletes/.test(t), h3.join('|'))

  const details = 'form:has(button:text("Save changes"))'
  await a.page.fill(`${details} textarea[name=description]`, 'Build first-step quickness and top-end speed')
  await clickAndWait(a.page, `${details} button:text("Save changes")`)
  await a.page.reload()
  check('program edit saved: new description shown', (await mainText(a.page)).includes('Build first-step quickness and top-end speed'))

  // curriculum for Foundation
  await a.page.locator('a:text-is("Curriculum")').first().click()
  await a.page.waitForURL(/\/levels\/[0-9a-f-]{36}$/, { timeout: 30000 })
  levelId = pathOf(a.page).split('/').pop()
  t = await mainText(a.page)
  check('level page opens with the empty curriculum state', t.includes('Foundation curriculum') && t.includes('No curriculum yet'), t.slice(0, 200))

  const addWeek = 'form:has(button:text("Add week"))'
  await a.page.fill(`${addWeek} input[name=title]`, 'Bad link')
  await a.page.fill(`${addWeek} input[name=video_url]`, 'not a url')
  // skip the browser's own URL check so the server-side message is what gets exercised
  await a.page.evaluate(() => document.querySelector('input[name=video_url]').form.setAttribute('novalidate', ''))
  await a.page.click(`${addWeek} button:text("Add week")`)
  await a.page.waitForSelector('form [role=alert]')
  check('a bad video link is rejected with a message', (await a.page.textContent('form [role=alert]')).includes('Video link must be a valid URL'))
  await a.page.reload()
  check('the rejected week was not saved', (await mainText(a.page)).includes('No curriculum yet'))

  await a.page.fill(`${addWeek} input[name=week_number]`, '1')
  await a.page.fill(`${addWeek} input[name=title]`, wk1)
  await a.page.fill(`${addWeek} textarea[name=objectives]`, 'Drive angle and shin position')
  await a.page.fill(`${addWeek} textarea[name=drills]`, 'Dynamic warm-up\nWall drill\nFalling starts')
  await a.page.fill(`${addWeek} textarea[name=cues]`, 'Push the floor away')
  await clickAndWait(a.page, `${addWeek} button:text("Add week")`)
  await a.page.reload()
  t = await mainText(a.page)
  check('added week shows title, objectives, cues', /week 1/i.test(t) && t.includes(wk1) && t.includes('Drive angle and shin position') && t.includes('Push the floor away'), t.slice(0, 300))
  check('drills render as a numbered list in order', (await a.page.locator('main ol li').allTextContents()).join('|') === 'Dynamic warm-up|Wall drill|Falling starts')

  await a.page.fill(`${addWeek} input[name=week_number]`, '2')
  await a.page.fill(`${addWeek} input[name=title]`, wk2)
  await a.page.fill(`${addWeek} textarea[name=drills]`, 'Flying 20s\nWicket runs')
  await clickAndWait(a.page, `${addWeek} button:text("Add week")`)
  await a.page.reload()
  t = await mainText(a.page)
  check('second week is listed after the first', t.includes(wk2) && t.indexOf(wk1) < t.indexOf(wk2))

  const card1 = a.page.locator('details').first()
  await card1.locator('summary').click()
  await card1.locator('input[name=title]').fill(wk1Edited)
  await clickAndWait(a.page, card1.locator('button:text("Save changes")'))
  await a.page.reload()
  t = await mainText(a.page)
  check('curriculum edit saved: week 1 has the new title', t.includes(wk1Edited) && !t.includes(`${wk1}\n`) && /week 1/i.test(t))

  // everything shows on the program page and the programs list
  await a.page.goto(`${BASE}/programs/${programId}`)
  t = await mainText(a.page)
  check('program page: Foundation has 2 weeks, Advanced has none', /2 weeks of curriculum/.test(t) && /0 weeks of curriculum/.test(t), t.slice(0, 400))
  await a.page.goto(`${BASE}/programs`)
  t = await mainText(a.page)
  check('programs list shows the program with both levels', t.includes(progName) && t.includes('Foundation') && t.includes('Advanced') && /2 levels/.test(t) && !/\b(null|undefined)\b/.test(t), t.slice(0, 300))
}
{
  await b.page.goto(`${BASE}/programs`)
  check("org B's programs list is empty (A's program is invisible)", (await mainText(b.page)).includes('No programs yet'))
  await b.page.goto(`${BASE}/programs/${programId}`)
  check("B opening A's program by id is blocked", await isBlocked(b.page, [progName]), pathOf(b.page))
  await b.page.goto(`${BASE}/programs/${programId}/levels/${levelId}`)
  check("B opening A's level curriculum by id is blocked", await isBlocked(b.page, [progName, wk1Edited]), pathOf(b.page))
}

// ---- sessions + attendance (org A, signed in as the owner) --------------------------------------------------
const coachName = `Coach Rae${stamp}`
const coachEmail = `coach-${stamp}@example.test`
const coachPassword = 'coach-pass-123'
const casey = `${first} Alvarez-Reyes`
const devon = `Devon${stamp} Okafor`
let devonId, sessAId, sessBId
{
  await a.page.goto(`${BASE}/coaches`)
  check('empty org shows the "No coaches yet" state', (await mainText(a.page)).includes('No coaches yet'))
  await a.page.fill('form:has(button:text("Add coach")) input[name=name]', coachName)
  await a.page.fill('form:has(button:text("Add coach")) input[name=email]', coachEmail)
  await clickAndWait(a.page, 'button:text("Add coach")')
  await a.page.reload()
  const t = await mainText(a.page)
  check('coach added: listed with email and no app access yet', t.includes(coachName) && t.includes(coachEmail) && t.includes('No app access yet'), t.slice(0, 300))

  devonId = await addAthlete(a.page, `Devon${stamp}`, 'Okafor')
  await setProgram(a.page, aId, progName, 'Foundation')
  await setProgram(a.page, devonId, progName, 'Foundation')
  const prof = await mainText(a.page)
  check('athlete profile shows the program and level', prof.includes(progName) && prof.includes('Foundation'), prof.slice(0, 300))
  await a.page.goto(`${BASE}/programs/${programId}`)
  check('program page counts the 2 enrolled athletes', /2\s*\/\s*10 athletes/.test(await mainText(a.page)))

  // session A: manual roster, no coach
  await a.page.goto(`${BASE}/schedule`)
  check('empty schedule shows "No sessions this week"', (await mainText(a.page)).includes('No sessions this week'))
  await a.page.goto(`${BASE}/schedule/new`)
  await a.page.selectOption('select[name=level_id]', { label: 'Foundation' })
  await a.page.fill('input[name=end]', '14:00')
  await a.page.click('button:text("Create session")')
  await a.page.waitForSelector('form [role=alert]')
  check('a session that ends before it starts is rejected', (await a.page.textContent('form [role=alert]')).includes('End time must be after start time') && pathOf(a.page) === '/schedule/new')

  // React resets uncontrolled fields after a submitted action, so fill the form again
  await a.page.selectOption('select[name=level_id]', { label: 'Foundation' })
  await a.page.selectOption('select[name=curriculum_item_id]', { label: `Week 1: ${wk1Edited}` })
  await a.page.fill('input[name=start]', '15:00')
  await a.page.fill('input[name=end]', '16:00')
  await a.page.uncheck('input[name=auto_enroll]')
  await Promise.all([a.page.waitForURL(/\/schedule\/[0-9a-f-]{36}$/, { timeout: 30000 }), a.page.click('button:text("Create session")')])
  sessAId = pathOf(a.page).split('/').pop()
  let s = await mainText(a.page)
  check('session opens for the program and level with no coach', s.includes(`${progName} · Foundation`) && s.includes('No coach assigned'), s.slice(0, 300))
  check('focus and plan are filled from the curriculum week', s.includes(wk1Edited) && s.includes('Wall drill') && s.includes('Curriculum week 1'), s.slice(0, 500))
  check('roster starts empty (auto-enroll was off)', s.includes('No athletes enrolled in this session.') && s.includes('(0/12)'))

  for (const who of [casey, devon]) {
    await a.page.selectOption('select[name=athlete_id]', { label: who })
    await clickAndWait(a.page, 'button:text-is("Enroll")')
    await a.page.reload()
  }
  s = await mainText(a.page)
  check('both athletes are on the roster', s.includes(casey) && s.includes(devon) && s.includes('(2/12)'), s.slice(0, 400))
  check('enrolled athletes are no longer offered in the enroll list', !(await a.page.locator('select[name=athlete_id] option').allTextContents()).some((o) => o.includes(casey) || o.includes(devon)))
  check('nothing is marked yet', (await attendanceSummary(a.page)) === '0 present · 0 late · 0 absent · 2 unmarked', await attendanceSummary(a.page))

  await tap(a.page, casey, 'Present')
  check('marking Casey present updates the counts', (await attendanceSummary(a.page)) === '1 present · 0 late · 0 absent · 1 unmarked', await attendanceSummary(a.page))
  await tap(a.page, devon, 'Absent')
  await a.page.reload()
  check('marks persist after a reload', (await isOn(a.page, casey, 'Present')) === 'true' && (await isOn(a.page, devon, 'Absent')) === 'true' && (await attendanceSummary(a.page)) === '1 present · 0 late · 1 absent', await attendanceSummary(a.page))
  await tap(a.page, devon, 'Absent')
  await a.page.reload()
  check('tapping the same mark again clears it', (await isOn(a.page, devon, 'Absent')) === 'false' && (await attendanceSummary(a.page)).includes('1 unmarked'), await attendanceSummary(a.page))
  await clickAndWait(a.page, 'button:text("Mark rest present")')
  await a.page.reload()
  check('"Mark rest present" marks only the unmarked athlete', (await attendanceSummary(a.page)) === '2 present · 0 late · 0 absent', await attendanceSummary(a.page))
  await tap(a.page, devon, 'Late')
  await a.page.reload()
  check('changing a mark to Late sticks', (await isOn(a.page, devon, 'Late')) === 'true' && (await isOn(a.page, devon, 'Present')) === 'false' && (await attendanceSummary(a.page)) === '1 present · 1 late · 0 absent', await attendanceSummary(a.page))

  await a.page.goto(`${BASE}/schedule`)
  s = await mainText(a.page)
  check('schedule lists the session as today with 2/2 attended', s.includes(progName) && s.includes('Today') && s.includes('2/2 attended'), s.slice(0, 400))
  await a.page.goto(`${BASE}/athletes/${aId}`)
  check("Casey's profile counts the attended session", /1\s*\/\s*1 sessions/.test(await mainText(a.page)))

  // session B: coach assigned, level roster auto-enrolled
  await a.page.goto(`${BASE}/schedule/new`)
  await a.page.selectOption('select[name=level_id]', { label: 'Foundation' })
  await a.page.selectOption('select[name=curriculum_item_id]', { label: `Week 2: ${wk2}` })
  await a.page.selectOption('select[name=coach_id]', { label: coachName })
  await a.page.fill('input[name=start]', '17:00')
  await a.page.fill('input[name=end]', '18:00')
  await Promise.all([a.page.waitForURL(/\/schedule\/[0-9a-f-]{36}$/, { timeout: 30000 }), a.page.click('button:text("Create session")')])
  sessBId = pathOf(a.page).split('/').pop()
  s = await mainText(a.page)
  check("session B shows the coach and the level's athletes auto-enrolled", s.includes(coachName) && s.includes(casey) && s.includes(devon) && s.includes('(2/12)'), s.slice(0, 400))
  check('session B has no attendance yet', (await attendanceSummary(a.page)) === '0 present · 0 late · 0 absent · 2 unmarked')
}
{
  await b.page.goto(`${BASE}/schedule`)
  check("org B's schedule is empty (A's sessions are invisible)", (await mainText(b.page)).includes('No sessions this week'))
  await b.page.goto(`${BASE}/schedule/${sessAId}`)
  check("B opening A's session by id is blocked", await isBlocked(b.page, [progName, casey]), pathOf(b.page))
  await b.page.goto(`${BASE}/coaches`)
  check("org B's coach list never shows A's coach", !(await b.page.innerText('body')).includes(coachName))
}

// ---- coach: invite, sign in, Today, attendance, owner-only pages closed ------------------------------------
const c = await launch({ width: 390, height: 844 })
{
  await a.page.goto(`${BASE}/coaches`)
  await a.page.click('button:text("Give app access")')
  await a.page.waitForSelector('input[aria-label="Invite link"]')
  const link = await a.page.inputValue('input[aria-label="Invite link"]')
  check('owner gets a one-time sign-in link for the coach', link.includes('/auth/confirm?token_hash='))

  await c.page.goto(link)
  await c.page.waitForURL('**/set-password', { timeout: 30000 })
  await c.page.fill('input[name=password]', coachPassword)
  await Promise.all([c.page.waitForURL('**/coach/today', { timeout: 30000 }), c.page.click('button[type=submit]')])
  check('coach lands on /coach/today after setting a password', pathOf(c.page) === '/coach/today', pathOf(c.page))

  let t = await mainText(c.page)
  const cards = c.page.locator('main a[href^="/coach/sessions/"]')
  check("Today lists only the coach's own session, not the unassigned one", (await cards.count()) === 1 && (await cards.first().getAttribute('href')) === `/coach/sessions/${sessBId}`)
  check('the card shows program, level, focus, athletes and attendance not taken', t.includes(progName) && t.includes('Foundation') && t.includes(wk2) && t.includes('2 athletes') && /Not started|Attendance not taken/.test(t), t.slice(0, 400))
  const tabs = (await c.page.locator('nav a').allTextContents()).join('|')
  check('coach nav has Today, Athletes, Assessments and no owner links', ['Today', 'Athletes', 'Assessments'].every((x) => tabs.includes(x)) && !/Settings|Programs|Schedule|Coaches|Dashboard/.test(tabs), tabs)

  await cards.first().click()
  await c.page.waitForURL(new RegExp(`/coach/sessions/${sessBId}$`), { timeout: 30000 })
  t = await mainText(c.page)
  check("coach's session page shows the plan and both athletes", t.includes(wk2) && t.includes('Flying 20s') && t.includes(casey) && t.includes(devon), t.slice(0, 400))
  await tap(c.page, casey, 'Present')
  await tap(c.page, devon, 'Absent')
  await c.page.reload()
  check('coach marks attendance and it persists', (await isOn(c.page, casey, 'Present')) === 'true' && (await isOn(c.page, devon, 'Absent')) === 'true' && (await attendanceSummary(c.page)) === '1 present · 0 late · 1 absent', await attendanceSummary(c.page))
  await c.page.goto(`${BASE}/coach/today`)
  check('Today now shows 1/2 attended', (await mainText(c.page)).includes('1/2 attended'))

  await a.page.goto(`${BASE}/schedule/${sessBId}`)
  check("owner sees the coach's attendance on the session", (await isOn(a.page, casey, 'Present')) === 'true' && (await isOn(a.page, devon, 'Absent')) === 'true')
  await a.page.goto(`${BASE}/coaches`)
  t = await mainText(a.page)
  check('coaches page shows the coach has app access and one session today', t.includes('Has app access') && /1\s*today/.test(t), t.slice(0, 300))

  // owner-only pages are closed to the coach
  for (const route of ['/settings', '/dashboard', '/athletes', `/athletes/${aId}`, '/programs', `/programs/${programId}`, '/coaches', '/schedule', `/schedule/${sessAId}`, '/assessments']) {
    await c.page.goto(`${BASE}${route}`)
    const body = await c.page.innerText('body')
    check(`coach opening ${route} is sent back to /coach/today`, pathOf(c.page) === '/coach/today' && !body.includes('Owners & admins') && !body.includes('Add location'), pathOf(c.page))
  }
}

// ---- assessments: metric, record results, athlete progress timeline ----------------------------------------
{
  await a.page.goto(`${BASE}/assessments`)
  let t = await mainText(a.page)
  check('empty org shows no metrics and no results', t.includes('No metrics yet') && t.includes('No results recorded yet.'), t.slice(0, 300))
  await a.page.goto(`${BASE}/assessments/record`)
  check('recording with no metrics explains that a metric is needed first', (await mainText(a.page)).includes('No assessment metrics yet'))

  await a.page.goto(`${BASE}/assessments`)
  const addMetric = 'form:has(button:text("Add metric"))'
  await a.page.fill(`${addMetric} input[name=name]`, '10 Yard Sprint')
  await a.page.fill(`${addMetric} input[name=unit]`, 'sec')
  await a.page.fill(`${addMetric} input[name=category]`, 'Speed')
  await clickAndWait(a.page, `${addMetric} button:text("Add metric")`)
  await a.page.reload()
  t = await mainText(a.page)
  check('metric added: listed with unit and direction', t.includes('10 Yard Sprint') && t.includes('sec · lower is better') && t.includes('0 results'), t.slice(0, 400))

  const m1 = a.page.locator('details').first()
  await m1.locator('summary').click()
  await m1.locator('input[name=reassess_days]').fill('30')
  await clickAndWait(a.page, m1.locator('button:text-is("Save")'))
  await a.page.reload()
  await a.page.locator('details').first().locator('summary').click()
  check('metric edit saved: reassess days now 30', (await a.page.locator('details').first().locator('input[name=reassess_days]').inputValue()) === '30')

  // owner records a backdated round, then today's round
  await a.page.goto(`${BASE}/assessments/record`)
  await a.page.click('a[href*="?level="]:has-text("Foundation")')
  await a.page.waitForURL(/[?&]level=/, { timeout: 30000 })
  await a.page.fill('input[name=recorded_on]', isoDay(-14))
  await a.page.fill(`input[aria-label="${casey} result in sec"]`, '2.15')
  await a.page.fill(`input[aria-label="${devon} result in sec"]`, '2.4')
  await clickAndWait(a.page, 'button:text("Save 2 results")')
  await seen(a.page, 'Saved 2 results.')
  await seen(a.page, 'Last: 2.15 sec')
  check('first round saved for both athletes', (await mainText(a.page)).includes('Saved 2 results.'))

  await a.page.fill(`input[aria-label="${casey} result in sec"]`, '2.05')
  await a.page.fill(`input[aria-label="${devon} result in sec"]`, 'abc')
  await a.page.click('button:text("Save 2 results")')
  await a.page.waitForSelector('form [role=alert]')
  check('a non-numeric result is rejected with a message', (await a.page.textContent('form [role=alert]')).includes('"abc" is not a valid number'))
  t = await mainText(a.page)
  check('typing a better time shows the previous result and a green delta', t.includes('Last: 2.15 sec') && t.includes('-0.1') && t.includes('▲'), t.slice(0, 400))
  await a.page.fill(`input[aria-label="${devon} result in sec"]`, '')
  await clickAndWait(a.page, 'button:text("Save 1 result")')
  await seen(a.page, 'Saved 1 result.')

  await a.page.goto(`${BASE}/athletes/${aId}`)
  t = await mainText(a.page)
  const i205 = t.search(/10 Yard Sprint: 2\.05\d* sec/)
  const i215 = t.search(/10 Yard Sprint: 2\.15\d* sec/)
  check('both results are on the athlete progress timeline, newest first', i205 > -1 && i215 > -1 && i205 < i215, t.slice(0, 800))
  check('timeline tags the events as Assessment', /Assessment\s*\n?\s*10 Yard Sprint: 2\.05/.test(t) || /· Assessment/.test(t))
  check('assessment progress shows 2.15 -> 2.05 as an improvement', /2\.15\s*→\s*2\.05/.test(t) && t.includes('▲'), t.slice(0, 800))
  check('assessment history lists the metric with both results', t.includes('Assessment history') && t.includes('10 Yard Sprint') && !t.includes('No assessments recorded yet.'))

  await a.page.goto(`${BASE}/assessments`)
  t = await mainText(a.page)
  check('assessments page lists the latest result with its unit', t.includes(casey) && /2\.05 sec/.test(t), t.slice(0, 500))
}

// coach records a result for their session's group; it lands on that athlete's timeline for owner and coach
{
  await c.page.goto(`${BASE}/coach/sessions/${sessBId}`)
  await c.page.click('a:text("Record assessments for this group")')
  await c.page.waitForURL(/\/coach\/assessments\?session=/, { timeout: 30000 })
  await c.page.fill(`input[aria-label="${devon} result in sec"]`, '2.3')
  await clickAndWait(c.page, 'button:text("Save 1 result")')
  await seen(c.page, 'Saved 1 result.')
  await c.page.goto(`${BASE}/coach/athletes/${devonId}`)
  let t = await mainText(c.page)
  check("coach sees the new result on the athlete's timeline", /10 Yard Sprint: 2\.3\d* sec/.test(t) && /10 Yard Sprint: 2\.4\d* sec/.test(t), t.slice(0, 600))
  await a.page.goto(`${BASE}/athletes/${devonId}`)
  t = await mainText(a.page)
  check("owner sees the coach's result on Devon's timeline too", /10 Yard Sprint: 2\.3\d* sec/.test(t), t.slice(0, 600))

  await b.page.goto(`${BASE}/assessments`)
  t = await mainText(b.page)
  check("org B sees none of A's metrics or results", t.includes('No metrics yet') && !t.includes(first) && !t.includes('10 Yard Sprint'), t.slice(0, 300))
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
  check('no console errors on the happy path (coach)', realErrors(c.errors).length === 0, realErrors(c.errors).join(' | ').slice(0, 300))
}

await a.browser.close()
await b.browser.close()
await c.browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
done()

function tplCopyPath() { return path.join(tmp, 'template.csv') }
