import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadState, saveState, statePath } from '../lib/state.js'

const dir = mkdtempSync(resolve('.tmp-state-'))
const file = statePath(dir)

test('loadState: missing file → undefined', () => {
  assert.equal(loadState(file), undefined)
})

test('saveState/loadState: round-trip and normalize target fields', () => {
  saveState(file, [
    { package: '@tencent-connect/dsh-qqbot', rowId: 'im-qqbot', dir: 'qqbot', preset: 'bot-sandbox-chat-only' },
    { package: 'dsh-otherbot', rowId: 'other-bot' },
  ])
  const targets = loadState(file)
  assert.equal(targets.length, 2)
  assert.deepEqual(targets[0], {
    package: '@tencent-connect/dsh-qqbot',
    rowId: 'im-qqbot',
    dir: 'qqbot',
    preset: 'bot-sandbox-chat-only',
  })
  assert.equal(targets[1].dir, '')
  assert.equal(targets[1].preset, '')
})

test('loadState: empty target list is a valid saved state', () => {
  saveState(file, [])
  assert.deepEqual(loadState(file), [])
})

test('loadState: malformed json or missing targets → undefined', () => {
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{not json')
  assert.equal(loadState(bad), undefined)
  const noTargets = join(dir, 'no-targets.json')
  writeFileSync(noTargets, JSON.stringify({ version: 1 }))
  assert.equal(loadState(noTargets), undefined)
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
