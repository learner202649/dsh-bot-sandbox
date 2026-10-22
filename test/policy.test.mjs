import test from 'node:test'
import assert from 'node:assert/strict'
import { cwdOf, decideTool, isRestrictedCwd, normalizePath } from '../lib/policy.js'

const ROOT = 'C:\\Users\\alice\\.dsh\\untrusted-bots'
const SANDBOX = ROOT + '\\qqbot'
const config = { restrictedCwds: [ROOT], allowTools: [] }

test('normalizePath: case, slashes, trailing separators', () => {
  assert.equal(normalizePath('C:/Users/Alice/X/'), 'c:\\users\\alice\\x')
  assert.equal(normalizePath(''), '')
  assert.equal(normalizePath(undefined), '')
})

test('isRestrictedCwd: root and descendants match, case-insensitive', () => {
  assert.equal(isRestrictedCwd(ROOT, [ROOT]), true)
  assert.equal(isRestrictedCwd(SANDBOX + '\\sub', [ROOT]), true)
  assert.equal(isRestrictedCwd(SANDBOX.toUpperCase(), [ROOT]), true)
})

test('isRestrictedCwd: normal Harness workspace is not restricted', () => {
  assert.equal(isRestrictedCwd('C:\\Users\\alice\\projects\\demo', [ROOT]), false)
  assert.equal(isRestrictedCwd('C:\\Users\\alice\\.dsh\\profiles\\desktop', [ROOT]), false)
  assert.equal(isRestrictedCwd(undefined, [ROOT]), false)
})

test('decideTool: every tool denied by default inside the sandbox', () => {
  for (const tool of ['read', 'write', 'pwsh', 'qqbot_send_file', 'subagent']) {
    assert.equal(typeof decideTool(tool, SANDBOX, config), 'string')
  }
})

test('decideTool: allowTools is an explicit escape hatch', () => {
  const withAllow = { ...config, allowTools: ['web_search'] }
  assert.equal(decideTool('web_search', SANDBOX, withAllow), undefined)
  assert.equal(typeof decideTool('read', SANDBOX, withAllow), 'string')
})

test('decideTool: normal sessions are untouched', () => {
  assert.equal(decideTool('read', 'C:\\Users\\alice\\projects\\demo', config), undefined)
  assert.equal(decideTool('pwsh', undefined, config), undefined)
})

test('cwdOf: reads the live Session header and falls back defensively', () => {
  assert.equal(cwdOf({ session: { header: { cwd: SANDBOX } } }), SANDBOX)
  assert.equal(cwdOf({ session: { meta: { cwd: SANDBOX } } }), SANDBOX)
  assert.equal(cwdOf({ session: { cwd: SANDBOX } }), SANDBOX)
  assert.equal(cwdOf({ meta: { cwd: SANDBOX } }), SANDBOX)
  assert.equal(cwdOf({}), undefined)
})
