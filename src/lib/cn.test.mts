import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cn } from './cn.ts'

test('joins truthy class values and drops falsy ones', () => {
  assert.equal(cn('a', false, null, undefined, '', 'b'), 'a b')
  assert.equal(cn('a', { b: true, c: false }, ['d']), 'a b d')
})

test('lets later tailwind classes override conflicting earlier ones', () => {
  assert.equal(cn('p-2 text-sm', 'p-4'), 'text-sm p-4')
  assert.equal(cn('text-red-500', false && 'x', 'text-blue-500'), 'text-blue-500')
})

test('returns an empty string for no input', () => {
  assert.equal(cn(), '')
})
