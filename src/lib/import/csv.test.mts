import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from './csv.ts'

test('parses plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']])
})

test('handles a missing trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
})

test('handles CRLF and lone CR line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('a,b\r1,2\r'), [['a', 'b'], ['1', '2']])
})

test('strips a leading BOM but only at the start', () => {
  assert.deepEqual(parseCsv('﻿name,age\nAda,9'), [['name', 'age'], ['Ada', '9']])
  assert.deepEqual(parseCsv('a\n﻿b'), [['a'], ['﻿b']])
})

test('keeps commas inside quoted fields', () => {
  assert.deepEqual(parseCsv('"Doe, Jane",x\n'), [['Doe, Jane', 'x']])
})

test('unescapes doubled quotes', () => {
  assert.deepEqual(parseCsv('"say ""hi""",x\n'), [['say "hi"', 'x']])
})

test('keeps embedded newlines (LF and CRLF) inside quoted fields', () => {
  assert.deepEqual(parseCsv('a,"line1\nline2"\n'), [['a', 'line1\nline2']])
  assert.deepEqual(parseCsv('a,"line1\r\nline2"\r\nb,c\r\n'), [['a', 'line1\r\nline2'], ['b', 'c']])
})

test('preserves empty fields', () => {
  assert.deepEqual(parseCsv('a,,c\n,,x\n'), [['a', '', 'c'], ['', '', 'x']])
  assert.deepEqual(parseCsv('a,b,\n'), [['a', 'b', '']])
})

test('skips blank and whitespace-only rows', () => {
  assert.deepEqual(parseCsv('a,b\n\n  ,  \n\r\n1,2\n\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('a\n"",""\nb'), [['a'], ['b']])
})

test('does not trim field whitespace', () => {
  assert.deepEqual(parseCsv(' a , b \n'), [[' a ', ' b ']])
})

test('returns no rows for empty input', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('﻿'), [])
})

test('treats an unterminated quote as running to end of input', () => {
  assert.deepEqual(parseCsv('a,"b\nc'), [['a', 'b\nc']])
})
