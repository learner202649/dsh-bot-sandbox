import test from 'node:test'
import assert from 'node:assert/strict'
import { installedTargets, profilePackages, targetDirName } from '../lib/detect.js'

const qqbot = { package: '@tencent-connect/dsh-qqbot', rowId: 'im-qqbot', dir: 'qqbot' }
const other = { package: 'dsh-otherbot', rowId: 'other-bot', dir: '' }

test('profilePackages: unions dependencies and bundles', () => {
  const names = profilePackages({
    dependencies: { '@tencent-connect/dsh-qqbot': '^0.5.2' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-otherbot'] } },
  })
  assert.equal(names.has('@tencent-connect/dsh-qqbot'), true)
  assert.equal(names.has('dsh-otherbot'), true)
  assert.equal(names.has('@deepseek-ai/dsh-base'), true)
  assert.equal(names.has('missing'), false)
})

test('installedTargets: filters to what this profile actually has', () => {
  const installed = installedTargets(
    {
      dependencies: { '@tencent-connect/dsh-qqbot': '^0.5.2' },
      dsh: { profile: { bundles: ['dsh-otherbot'] } },
    },
    [qqbot, other, { package: 'not-installed', rowId: 'x' }],
  )
  assert.deepEqual(installed.map((t) => t.package), ['@tencent-connect/dsh-qqbot', 'dsh-otherbot'])
})

test('targetDirName: explicit dir, scoped package, unscoped package', () => {
  assert.equal(targetDirName(qqbot), 'qqbot')
  assert.equal(targetDirName(other), 'dsh-otherbot')
  assert.equal(targetDirName({ package: '@scope/bot' }), 'scope-bot')
})

test('targetDirName: unsafe dir never escapes the sandbox root', () => {
  assert.equal(targetDirName({ package: 'dsh-otherbot', dir: '..\\..\\Windows' }), 'dsh-otherbot')
  assert.equal(targetDirName({ package: 'dsh-otherbot', dir: '..' }), 'dsh-otherbot')
  assert.equal(targetDirName({ package: 'dsh-otherbot', dir: 'ok-name' }), 'ok-name')
})

test('installedTargets: a target without package is ignored', () => {
  assert.deepEqual(installedTargets({ dependencies: {}, dsh: { profile: { bundles: [] } } }, [null, { rowId: 'x' }]), [])
})
