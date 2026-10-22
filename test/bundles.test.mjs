import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { detectRowId, flattenPatchRows, listCandidates } from '../lib/bundles.js'

const dir = mkdtempSync(resolve('.tmp-bundles-'))
const profile = join(dir, 'profile')
const qqbotDir = join(profile, 'node_modules', '@tencent-connect', 'dsh-qqbot')
const otherDir = join(profile, 'node_modules', 'dsh-otherbot')
const plainDir = join(profile, 'node_modules', 'dsh-plain')
mkdirSync(qqbotDir, { recursive: true })
mkdirSync(otherDir, { recursive: true })
mkdirSync(plainDir, { recursive: true })

function writeBundle(dir, name, patchText) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.2.3', description: `${name} desc`, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  )
  writeFileSync(join(dir, 'cordis.patch.yml'), patchText)
}

writeBundle(
  qqbotDir,
  '@tencent-connect/dsh-qqbot',
  ['- insert:', '    - id: im-qqbot', "      name: '@tencent-connect/dsh-qqbot'", '      config: {}', ''].join('\n'),
)
writeBundle(
  otherDir,
  'dsh-otherbot',
  ['- insert:', '    - id: other-bot', "      name: 'dsh-otherbot'", '      config: {}', ''].join('\n'),
)
writeFileSync(join(plainDir, 'package.json'), JSON.stringify({ name: 'dsh-plain', version: '0.1.0' }))

test('flattenPatchRows: handles insert blocks and plain rows', () => {
  const rows = flattenPatchRows([
    { insert: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
    { id: 'c', name: 'c' },
    null,
  ])
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c'])
})

test('detectRowId: resolves the row a bundle declares for itself', () => {
  assert.deepEqual(detectRowId(profile, '@tencent-connect/dsh-qqbot'), { rowId: 'im-qqbot' })
  assert.deepEqual(detectRowId(profile, 'dsh-otherbot'), { rowId: 'other-bot' })
})

test('detectRowId: reports missing bundle patch and missing row', () => {
  assert.match(detectRowId(profile, 'dsh-plain').reason, /dsh\.bundle\.patch/)
  assert.match(detectRowId(profile, 'not-installed').reason, /dsh\.bundle\.patch/)
})

test('listCandidates: only bundles with a patch, marked controlled', () => {
  const candidates = listCandidates(
    profile,
    {
      dependencies: {
        '@tencent-connect/dsh-qqbot': '^0.5.2',
        'dsh-plain': '1.0.0',
      },
      dsh: { profile: { bundles: ['dsh-otherbot'] } },
    },
    new Set(['@tencent-connect/dsh-qqbot']),
  )
  assert.deepEqual(candidates.map((candidate) => candidate.package), ['@tencent-connect/dsh-qqbot', 'dsh-otherbot'])
  assert.equal(candidates[0].controlled, true)
  assert.equal(candidates[0].row.rowId, 'im-qqbot')
  assert.equal(candidates[1].controlled, false)
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
