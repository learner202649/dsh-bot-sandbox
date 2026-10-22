import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TMP = mkdtempSync(resolve('.tmp-bot-sandbox-'))
const HOME = join(TMP, 'home')
const PROFILE = join(HOME, 'profiles', 'desktop')
const SANDBOX = join(HOME, 'untrusted-bots', 'qqbot')
const WORKSPACE = join(TMP, 'workspace')
const PATCH = join(PROFILE, 'cordis.patch.yml')

mkdirSync(PROFILE, { recursive: true })
mkdirSync(WORKSPACE, { recursive: true })
writeFileSync(
  join(PROFILE, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-test',
      dependencies: { '@tencent-connect/dsh-qqbot': '^0.5.2' },
      dsh: { profile: { bundles: ['@tencent-connect/dsh-qqbot'] } },
    },
    null,
    2,
  ),
)
writeFileSync(
  PATCH,
  [
    '# existing profile patch',
    '- id: im-qqbot',
    '  config:',
    "    appId: '1905'",
    "    appSecret: 'secret'",
    '    access:',
    '      c2cMode: open',
    '      groupMode: open',
    '',
  ].join('\n'),
)

const saved = { home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE_DIR }
process.env.DSH_HOME = HOME
process.env.DSH_PROFILE_DIR = PROFILE

const { apply } = await import('../lib/index.js')
const yaml = (await import('js-yaml')).default

function makeCtx() {
  const guards = []
  const listeners = []
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) },
    tools: {
      guard(fn) {
        guards.push(fn)
        return () => {}
      },
    },
    effect(fn) {
      return fn()
    },
    on(event, fn, options) {
      listeners.push({ event, fn, options })
    },
  }
  return { ctx, guards, listeners, logs }
}

const target = {
  package: '@tencent-connect/dsh-qqbot',
  rowId: 'im-qqbot',
  dir: 'qqbot',
  preset: 'bot-sandbox-chat-only',
}

test('first apply pins cwd/preset, backs up, and preserves credentials', () => {
  const { ctx, logs } = makeCtx()
  apply(ctx, { targets: [target], autoApply: true })

  const entries = yaml.load(readFileSync(PATCH, 'utf8'))
  const row = entries.find((entry) => entry.id === 'im-qqbot')
  assert.equal(row.config.appId, '1905')
  assert.equal(row.config.appSecret, 'secret')
  assert.deepEqual(row.config.access, { c2cMode: 'open', groupMode: 'open' })
  assert.equal(row.config.cwd, SANDBOX)
  assert.equal(row.config.preset, 'bot-sandbox-chat-only')
  // The Agent is created with this cwd, so it must exist before the next turn.
  assert.equal(existsSync(SANDBOX), true)

  const backups = readdirSync(PROFILE).filter((name) => name.includes('.bak.'))
  assert.equal(backups.length, 1)
  assert.ok(logs.some((line) => line.includes('[bot-sandbox]')))
})

test('second apply is idempotent (no new backup, same content)', () => {
  const before = readFileSync(PATCH, 'utf8')
  const { ctx } = makeCtx()
  apply(ctx, { targets: [target], autoApply: true })
  assert.equal(readFileSync(PATCH, 'utf8'), before)
  const backups = readdirSync(PROFILE).filter((name) => name.includes('.bak.'))
  assert.equal(backups.length, 1)
})

test('guard denies sandbox sessions, allows normal Harness sessions', () => {
  const { ctx, guards } = makeCtx()
  apply(ctx, { targets: [target], autoApply: true })
  const guard = guards[0]
  assert.equal(typeof guard, 'function')

  const deny = guard({ name: 'read', agent: { session: { header: { cwd: SANDBOX } } } })
  assert.equal(typeof deny, 'string')
  const allowRead = guard({ name: 'read', agent: { session: { header: { cwd: WORKSPACE } } } })
  assert.equal(allowRead, undefined)
  const allowPwsh = guard({ name: 'pwsh', agent: { session: { header: { cwd: WORKSPACE } } } })
  assert.equal(allowPwsh, undefined)
})

test('approval requests from sandbox sessions are rejected locally', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, { targets: [target], autoApply: true })
  const approval = listeners.find((entry) => entry.event === 'approval/request')
  assert.ok(approval)
  assert.equal(approval.options?.prepend, true)

  const next = () => 'allowed-once'
  assert.equal(
    approval.fn({ agent: { session: { header: { cwd: SANDBOX } } }, callId: 'c1' }, next),
    'rejected',
  )
  assert.equal(
    approval.fn({ agent: { session: { header: { cwd: WORKSPACE } } }, callId: 'c2' }, next),
    'allowed-once',
  )
})

test('denials are appended to the audit log', () => {
  const { ctx, guards, listeners } = makeCtx()
  apply(ctx, { targets: [target], autoApply: true })
  guards[0]({ name: 'pwsh', agent: { session: { header: { cwd: SANDBOX } } } })
  const approval = listeners.find((entry) => entry.event === 'approval/request')
  approval.fn({ agent: { session: { header: { cwd: SANDBOX } } }, callId: 'c3' }, () => 'allowed-once')

  const audit = join(HOME, 'security-watch', 'bot-sandbox.jsonl')
  assert.equal(existsSync(audit), true)
  const lines = readFileSync(audit, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(lines.some((line) => line.event === 'tool-denied' && line.tool === 'pwsh'))
  assert.ok(lines.some((line) => line.event === 'approval-denied'))
})

test.after(() => {
  if (saved.home === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = saved.home
  if (saved.profile === undefined) delete process.env.DSH_PROFILE_DIR
  else process.env.DSH_PROFILE_DIR = saved.profile
  rmSync(TMP, { recursive: true, force: true })
})
