import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureTargetConfig, findPatchEntry, targetConfigOf } from '../lib/patch.js'

const ROW = { rowId: 'im-qqbot', cwd: 'C:\\Users\\alice\\.dsh\\untrusted-bots\\qqbot', preset: 'bot-sandbox-chat-only' }

test('ensureTargetConfig: creates a row when absent', () => {
  const entries = [{ id: 'agent-default-model', config: { provider: 'x' } }]
  assert.equal(ensureTargetConfig(entries, ROW), true)
  assert.deepEqual(targetConfigOf(entries, 'im-qqbot'), {
    cwd: ROW.cwd,
    preset: 'bot-sandbox-chat-only',
  })
})

test('ensureTargetConfig: preserves appId/appSecret/access while pinning', () => {
  const entries = [
    {
      id: 'im-qqbot',
      config: {
        appId: '1905',
        appSecret: 'secret',
        access: { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'disabled', groupAllow: [] },
        groupPrompt: 'persona',
      },
    },
  ]
  assert.equal(ensureTargetConfig(entries, ROW), true)
  const config = targetConfigOf(entries, 'im-qqbot')
  assert.equal(config.appId, '1905')
  assert.equal(config.appSecret, 'secret')
  assert.deepEqual(config.access, { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'disabled', groupAllow: [] })
  assert.equal(config.groupPrompt, 'persona')
  assert.equal(config.cwd, ROW.cwd)
  assert.equal(config.preset, 'bot-sandbox-chat-only')
})

test('ensureTargetConfig: idempotent once pinned', () => {
  const entries = []
  ensureTargetConfig(entries, ROW)
  assert.equal(ensureTargetConfig(entries, ROW), false)
})

test('ensureTargetConfig: empty preset does not erase a user preset', () => {
  const entries = [{ id: 'im-qqbot', config: { preset: 'custom', cwd: 'C:\\elsewhere' } }]
  ensureTargetConfig(entries, { rowId: 'im-qqbot', cwd: ROW.cwd, preset: '' })
  assert.equal(targetConfigOf(entries, 'im-qqbot').preset, 'custom')
  assert.equal(targetConfigOf(entries, 'im-qqbot').cwd, ROW.cwd)
})

test('findPatchEntry: ignores malformed rows', () => {
  const entries = [null, 'x', { id: 1 }, { id: 'ok', config: {} }]
  assert.equal(findPatchEntry(entries, 'ok')?.id, 'ok')
  assert.equal(findPatchEntry(entries, 'missing'), undefined)
})
