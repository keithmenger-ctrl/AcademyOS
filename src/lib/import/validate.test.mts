import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkGrid, validateRows, type ExistingAthlete, type ProgramRef } from './validate.ts'

const programs: ProgramRef[] = [
  { id: 'p1', name: 'Speed Lab', levels: [{ id: 'l1', name: 'Level 1' }, { id: 'l2', name: 'Level 2' }] },
  { id: 'p2', name: 'Strength', levels: [] },
]

function run(csv: string[][], existing: ExistingAthlete[] = []) {
  const checked = checkGrid(csv)
  assert.ok('headers' in checked, 'expected the grid to pass checkGrid')
  return validateRows(csv, checked.headers, programs, existing)
}

const H = ['First name', 'Last name']

test('checkGrid rejects files without data rows or with too many', () => {
  assert.match(String((checkGrid([]) as { error: string }).error), /header row and at least one athlete/)
  assert.match(String((checkGrid([H]) as { error: string }).error), /header row and at least one athlete/)
  const big = [H, ...Array.from({ length: 1001 }, () => ['A', 'B'])]
  assert.match(String((checkGrid(big) as { error: string }).error), /up to 1,000/)
  assert.equal('error' in checkGrid(big.slice(0, 1001)), false)
})

test('checkGrid requires first and last name columns and reports unknown headers', () => {
  const r = checkGrid([['First name', 'Shoe size', ' '], ['A']]) as { error: string; unknownHeaders: string[] }
  assert.match(r.error, /"First name" and "Last name" are required/)
  assert.deepEqual(r.unknownHeaders, ['Shoe size'])
})

test('checkGrid maps header aliases case- and punctuation-insensitively', () => {
  const r = checkGrid([['FIRST', 'Surname', 'Birth-Date', 'School/Team', 'Guardian Email', 'Mystery'], ['a']])
  assert.ok('headers' in r)
  assert.deepEqual(r.headers, ['first_name', 'last_name', 'dob', 'school_team', 'parent_email', null])
  assert.deepEqual(r.unknownHeaders, ['Mystery'])
})

test('a minimal valid row defaults to active with no errors', () => {
  const [r] = run([H, ['  Ada ', 'Lovelace']])
  assert.equal(r.first_name, 'Ada')
  assert.equal(r.last_name, 'Lovelace')
  assert.equal(r.status, 'active')
  assert.equal(r.line, 2)
  assert.deepEqual(r.errors, [])
  assert.equal(r.duplicate, false)
})

test('reports missing names and tracks line numbers', () => {
  const rows = run([H, ['Ada', 'L'], ['', 'Smith'], ['Bob', '']])
  assert.deepEqual(rows.map((r) => r.line), [2, 3, 4])
  assert.deepEqual(rows[1].errors, ['First name is missing'])
  assert.deepEqual(rows[2].errors, ['Last name is missing'])
})

test('parses ISO and US dates, including 2-digit year pivot', () => {
  const grid = [[...H, 'DOB', 'Join date'],
    ['A', 'A', '2012-3-7', '9/1/2024'],
    ['B', 'B', '3/7/12', '12/31/99'],
    ['C', 'C', '3/7/45', '']]
  const rows = run(grid)
  assert.equal(rows[0].dob, '2012-03-07')
  assert.equal(rows[0].join_date, '2024-09-01')
  assert.equal(rows[1].dob, '2012-03-07')
  assert.equal(rows[1].join_date, '1999-12-31')
  assert.equal(rows[2].dob, '1945-03-07')
  assert.equal(rows[2].join_date, undefined)
  assert.deepEqual(rows.flatMap((r) => r.errors), [])
})

test('rejects impossible and unrecognised dates', () => {
  const rows = run([[...H, 'DOB', 'Join date'],
    ['A', 'A', '2/30/2012', ''],
    ['B', 'B', 'March 3', '2024-13-01'],
    ['C', 'C', '2023-02-29', '2024-02-29']])
  assert.deepEqual(rows[0].errors, ['Date of birth "2/30/2012" isn\'t a date'])
  assert.deepEqual(rows[1].errors, ['Date of birth "March 3" isn\'t a date', 'Join date "2024-13-01" isn\'t a date'])
  assert.deepEqual(rows[2].errors, ['Date of birth "2023-02-29" isn\'t a date'])
  assert.equal(rows[2].join_date, '2024-02-29')
})

test('validates status case-insensitively', () => {
  const rows = run([[...H, 'Status'], ['A', 'A', 'TRIAL'], ['B', 'B', 'gone'], ['C', 'C', '']])
  assert.equal(rows[0].status, 'trial')
  assert.deepEqual(rows[1].errors, ['Status "gone" should be active, trial, paused or inactive'])
  assert.equal(rows[1].status, 'active')
  assert.equal(rows[2].status, 'active')
})

test('copies optional text fields only when present', () => {
  const [r] = run([[...H, 'Sport', 'Position', 'School/team', 'Notes', 'Parent name', 'Parent phone'],
    ['A', 'B', 'Soccer', '', 'Lincoln HS', 'Likes drills', 'Pat', '555-1234']])
  assert.equal(r.sport, 'Soccer')
  assert.equal('position' in r, false)
  assert.equal(r.school_team, 'Lincoln HS')
  assert.equal(r.notes, 'Likes drills')
  assert.equal(r.parent_name, 'Pat')
  assert.equal(r.parent_phone, '555-1234')
})

test('validates and lowercases parent email, and requires a parent name with it', () => {
  const rows = run([[...H, 'Parent name', 'Parent email'],
    ['A', 'A', 'Pat', 'Pat@Example.COM'],
    ['B', 'B', 'Pat', 'not-an-email'],
    ['C', 'C', '', 'pat@example.com']])
  assert.equal(rows[0].parent_email, 'pat@example.com')
  assert.deepEqual(rows[0].errors, [])
  assert.deepEqual(rows[1].errors, ['Parent email "not-an-email" is invalid'])
  assert.deepEqual(rows[2].errors, ['Parent email given without a parent name'])
})

test('resolves program and level case-insensitively, with or without the "Level" prefix', () => {
  const rows = run([[...H, 'Program', 'Level'],
    ['A', 'A', 'speed lab', 'level 2'],
    ['B', 'B', 'Speed Lab', '1'],
    ['C', 'C', 'Strength', '']])
  assert.deepEqual([rows[0].program, rows[0].program_id, rows[0].level, rows[0].level_id], ['Speed Lab', 'p1', 'Level 2', 'l2'])
  assert.deepEqual([rows[1].level, rows[1].level_id], ['Level 1', 'l1'])
  assert.deepEqual([rows[2].program_id, rows[2].level_id], ['p2', undefined])
  assert.deepEqual(rows.flatMap((r) => r.errors), [])
})

test('reports unknown programs, unknown levels and a level without a program', () => {
  const rows = run([[...H, 'Program', 'Level'],
    ['A', 'A', 'Yoga', ''],
    ['B', 'B', 'Speed Lab', '9'],
    ['C', 'C', '', 'Level 1']])
  assert.deepEqual(rows[0].errors, ['Program "Yoga" doesn\'t exist yet'])
  assert.deepEqual(rows[1].errors, ['Level "9" isn\'t in Speed Lab'])
  assert.equal(rows[1].program_id, 'p1')
  assert.deepEqual(rows[2].errors, ['Level given without a program'])
})

test('flags duplicates of existing athletes by name and matching or missing DOB', () => {
  const existing: ExistingAthlete[] = [
    { k: 'ada|lovelace', dob: '2012-03-07' },
    { k: 'grace|hopper', dob: '2012-12-09' },
    { k: 'bob|nodob', dob: null },
  ]
  const rows = run([[...H, 'DOB'],
    ['Ada', 'Lovelace', '2012-03-07'],
    ['ADA', 'LOVELACE', ''],
    ['Grace', 'Hopper', '2013-01-01'],
    ['Bob', 'NoDOB', '2010-05-05']], existing)
  assert.deepEqual(rows.map((r) => r.duplicate), [true, true, false, true])
  assert.deepEqual(rows.flatMap((r) => r.errors), [])
})

test('flags repeats inside the same file, treating a missing DOB as a match', () => {
  const rows = run([[...H, 'DOB'],
    ['Cy', 'Young', '2010-01-01'],
    ['cy', 'young', '2010-01-01'],
    ['Cy', 'Young', '2011-01-01'],
    ['Cy', 'Young', '']])
  assert.deepEqual(rows[0].errors, [])
  assert.deepEqual(rows[1].errors, ['Same athlete appears twice in this file'])
  assert.deepEqual(rows[2].errors, [])
  assert.deepEqual(rows[3].errors, ['Same athlete appears twice in this file'])
  assert.deepEqual(rows.map((r) => r.duplicate), [false, false, false, false])
})
