import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TMP = mkdtempSync(resolve('.tmp-profile-'))
const HOME = join(TMP, 'home')
const PROFILE = join(HOME, 'profiles', 'desktop')
mkdirSync(PROFILE, { recursive: true })
writeFileSync(
  join(PROFILE, 'package.json'),
  JSON.stringify({
    name: 'profile',
    dependencies: { '@tencent-connect/dsh-qqbot': '^0.5.2' },
    dsh: { profile: { bundles: ['@tencent-connect/dsh-qqbot'] } },
  }),
)
writeFileSync(join(PROFILE, 'cordis.patch.yml'), "- id: im-qqbot\n  config:\n    appId: '1'\n    appSecret: 's'\n")

const saved = { home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE_DIR }
delete process.env.DSH_HOME
delete process.env.DSH_PROFILE_DIR

const { apply } = await import('../lib/index.js')
const yaml = (await import('js-yaml')).default

test('apply recovers the profile from ctx.baseUrl when the host env is absent', () => {
  const ctx = {
    baseUrl: pathToFileURL(PROFILE + '\\'),
    logger: { info: () => {}, warn: () => {} },
    tools: { guard: () => () => {} },
    effect: (fn) => fn(),
    on: () => {},
    inject: () => {},
  }
  apply(ctx, {
    targets: [{ package: '@tencent-connect/dsh-qqbot', rowId: 'im-qqbot', dir: 'qqbot', preset: 'bot-sandbox-chat-only' }],
    autoApply: true,
  })

  const stateFile = join(HOME, 'bot-sandbox.json')
  assert.equal(existsSync(stateFile), true)
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(state.targets.length, 1)

  const entries = yaml.load(readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8'))
  const row = entries.find((entry) => entry.id === 'im-qqbot')
  assert.match(row.config.cwd, /untrusted-bots/)
  assert.equal(row.config.preset, 'bot-sandbox-chat-only')
  assert.equal(existsSync(row.config.cwd), true)
})

test.after(() => {
  if (saved.home === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = saved.home
  if (saved.profile === undefined) delete process.env.DSH_PROFILE_DIR
  else process.env.DSH_PROFILE_DIR = saved.profile
  rmSync(TMP, { recursive: true, force: true })
})
