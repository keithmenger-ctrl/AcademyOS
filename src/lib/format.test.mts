import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { daysSince, fmtDate, fmtShortDate, fmtTime, fmtWeekday, initials, money, num, relativeDays } from './format.ts'

// The suite runs under several TZ values (see the "test" script); date-only results must not vary.
const zones = ['America/Los_Angeles', 'Pacific/Auckland', 'UTC', undefined]

test('date-only strings are calendar dates, never shifted by timezone', () => {
  for (const tz of zones) {
    assert.equal(fmtDate('2026-09-26', tz), 'Sep 26, 2026')
    assert.equal(fmtShortDate('2026-09-26', tz), 'Sep 26')
    assert.equal(fmtDate('2026-01-01', tz), 'Jan 1, 2026')
    assert.equal(fmtDate('2026-12-31', tz), 'Dec 31, 2026')
  }
})

test('timestamps are rendered in the requested timezone', () => {
  const ts = '2026-09-26T03:30:00Z'
  assert.equal(fmtDate(ts, 'America/Los_Angeles'), 'Sep 25, 2026')
  assert.equal(fmtDate(ts, 'Pacific/Auckland'), 'Sep 26, 2026')
  assert.equal(fmtShortDate(ts, 'America/Los_Angeles'), 'Sep 25')
  assert.equal(fmtDate(new Date(ts), 'America/Los_Angeles'), 'Sep 25, 2026')
})

test('empty dates render an em dash', () => {
  for (const v of [null, undefined, '']) {
    assert.equal(fmtDate(v), '—')
    assert.equal(fmtShortDate(v), '—')
  }
})

test('fmtTime and fmtWeekday use the given timezone', () => {
  const ts = '2026-09-26T03:30:00Z'
  assert.equal(fmtTime(ts, 'America/Los_Angeles'), '8:30 PM')
  assert.equal(fmtTime(ts, 'Pacific/Auckland'), '3:30 PM')
  assert.equal(fmtWeekday(ts, 'America/Los_Angeles'), 'Friday, Sep 25')
  assert.equal(fmtWeekday(new Date(ts), 'Pacific/Auckland'), 'Saturday, Sep 26')
})

test('money shows cents only when there are some', () => {
  assert.equal(money(0), '$0')
  assert.equal(money(5), '$0.05')
  assert.equal(money(150000), '$1,500')
  assert.equal(money(1550), '$15.50')
  assert.equal(money(1500), '$15')
  assert.equal(money(123456789), '$1,234,567.89')
  assert.equal(money(-1250), '-$12.50')
})

test('num trims trailing zeros', () => {
  assert.equal(num('3.50'), '3.5')
  assert.equal(num('12.000'), '12')
  assert.equal(num(7.25), '7.25')
  assert.equal(num('0'), '0')
})

test('initials uppercases and tolerates empty names', () => {
  assert.equal(initials('ada', 'lovelace'), 'AL')
  assert.equal(initials('', 'Lovelace'), 'L')
  assert.equal(initials('', ''), '')
})

test('daysSince and relativeDays count whole days back from now', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  mock.timers.enable({ apis: ['Date'], now })
  try {
    const ago = (ms: number) => new Date(now - ms).toISOString()
    const day = 86_400_000
    assert.equal(daysSince(null), null)
    assert.equal(daysSince(undefined), null)
    assert.equal(daysSince(ago(0)), 0)
    assert.equal(daysSince(ago(day - 1)), 0)
    assert.equal(daysSince(ago(day)), 1)
    assert.equal(daysSince(new Date(now - 3 * day)), 3)

    assert.equal(relativeDays(null), 'Never')
    assert.equal(relativeDays(undefined), 'Never')
    assert.equal(relativeDays(ago(0)), 'Today')
    assert.equal(relativeDays(ago(day)), 'Yesterday')
    assert.equal(relativeDays(ago(2 * day)), '2 days ago')
    assert.equal(relativeDays(ago(30 * day)), '30 days ago')
    assert.equal(relativeDays(new Date(now + 5 * day)), 'Today')
  } finally {
    mock.timers.reset()
  }
})
