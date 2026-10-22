import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TMP = mkdtempSync(resolve('.tmp-routes-'))
const HOME = join(TMP, 'home')
const PROFILE = join(HOME, 'profiles', 'desktop')
const ROOT = join(HOME, 'untrusted-bots')
const PATCH = join(PROFILE, 'cordis.patch.yml')
mkdirSync(PROFILE, { recursive: true })

function fakeBundle(name, rowId) {
  const dir = join(PROFILE, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} chat bot`, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  )
  writeFileSync(
    join(dir, 'cordis.patch.yml'),
    ['- insert:', `    - id: ${rowId}`, `      name: '${name}'`, '      config: {}', ''].join('\n'),
  )
}

fakeBundle('@tencent-connect/dsh-qqbot', 'im-qqbot')
fakeBundle('dsh-otherbot', 'other-bot')

writeFileSync(
  join(PROFILE, 'package.json'),
  JSON.stringify({
    name: 'profile',
    dependencies: { '@tencent-connect/dsh-qqbot': '^0.5.2', 'dsh-otherbot': '1.0.0' },
    dsh: { profile: { bundles: ['@tencent-connect/dsh-qqbot', 'dsh-otherbot'] } },
  }),
)
writeFileSync(PATCH, "- id: im-qqbot\n  config:\n    appId: '1'\n    appSecret: 's'\n")

const saved = { home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE_DIR }
process.env.DSH_HOME = HOME
process.env.DSH_PROFILE_DIR = PROFILE

const { apply } = await import('../lib/index.js')

const routes = []
const guards = []
const listeners = []
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  tools: { guard: (fn) => (guards.push(fn), () => {}) },
  effect: (fn) => fn(),
  on: (event, fn, options) => listeners.push({ event, fn, options }),
  inject: (_deps, callback) => callback({ connection: { fetch: { register: (route) => routes.push(route) } } }),
}

apply(ctx, {
  targets: [{ package: '@tencent-connect/dsh-qqbot', rowId: 'im-qqbot', dir: 'qqbot', preset: 'bot-sandbox-chat-only' }],
  autoApply: true,
})

const route = (path) => routes.find((entry) => entry.path === path)
const statePath = join(HOME, 'bot-sandbox.json')

function request(path, body) {
  return new Request(`http://127.0.0.1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('routes are registered and state lists candidates', async () => {
  for (const path of ['/api/bot-sandbox/state', '/api/bot-sandbox/add', '/api/bot-sandbox/remove', '/api/bot-sandbox/apply', '/api/bot-sandbox/audit']) {
    assert.ok(route(path), `missing ${path}`)
  }
  const response = await route('/api/bot-sandbox/state').fetch(request('/api/bot-sandbox/state'))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.targets.length, 1)
  const qqbot = body.candidates.find((candidate) => candidate.package === '@tencent-connect/dsh-qqbot')
  const other = body.candidates.find((candidate) => candidate.package === 'dsh-otherbot')
  assert.equal(qqbot.controlled, true)
  assert.equal(other.controlled, false)
  assert.equal(other.row.rowId, 'other-bot')
})

test('add route pins the new target and widens the live guard scope', async () => {
  const response = await route('/api/bot-sandbox/add').fetch(
    request('/api/bot-sandbox/add', { package: 'dsh-otherbot' }),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.targets.length, 2)

  const patch = readFileSync(PATCH, 'utf8')
  assert.match(patch, /other-bot/)
  assert.match(patch, /untrusted-bots/)

  const savedState = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(savedState.targets.length, 2)

  const guard = guards[0]
  assert.equal(typeof guard({ name: 'read', agent: { session: { header: { cwd: join(ROOT, 'dsh-otherbot') } } } }), 'string')
  assert.equal(guard({ name: 'read', agent: { session: { header: { cwd: join(TMP, 'workspace') } } } }), undefined)
})

test('restarting the guard keeps the persisted targets and protection', async () => {
  const guards2 = []
  const ctx2 = {
    logger: { info: () => {}, warn: () => {} },
    tools: { guard: (fn) => (guards2.push(fn), () => {}) },
    effect: (fn) => fn(),
    on: () => {},
    inject: (_deps, callback) => callback({ connection: { fetch: { register: () => {} } } }),
  }
  apply(ctx2, {
    targets: [{ package: '@tencent-connect/dsh-qqbot', rowId: 'im-qqbot', dir: 'qqbot', preset: 'bot-sandbox-chat-only' }],
    autoApply: true,
  })
  const savedState = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(savedState.targets.length, 2)
  const guard2 = guards2[0]
  assert.equal(typeof guard2({ name: 'read', agent: { session: { header: { cwd: join(ROOT, 'qqbot') } } } }), 'string')
  assert.equal(typeof guard2({ name: 'read', agent: { session: { header: { cwd: join(ROOT, 'dsh-otherbot') } } } }), 'string')
  assert.equal(guard2({ name: 'read', agent: { session: { header: { cwd: join(TMP, 'workspace') } } } }), undefined)
})

test('remove route narrows the guard scope again', async () => {
  const response = await route('/api/bot-sandbox/remove').fetch(
    request('/api/bot-sandbox/remove', { package: 'dsh-otherbot' }),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.targets.length, 1)

  const guard = guards[0]
  assert.equal(guard({ name: 'read', agent: { session: { header: { cwd: join(ROOT, 'dsh-otherbot') } } } }), undefined)
  assert.equal(typeof guard({ name: 'read', agent: { session: { header: { cwd: join(ROOT, 'qqbot') } } } }), 'string')
})

test('plugin-manager/changed re-pins a protected plugin after its config was reset', () => {
  // Simulate the protected plugin being disabled/re-enabled or reinstalled:
  // its row loses our cwd/preset override.
  writeFileSync(PATCH, "- id: im-qqbot\n  config:\n    appId: '1'\n    appSecret: 's'\n")
  const listener = listeners.find((entry) => entry.event === 'plugin-manager/changed')
  assert.ok(listener)
  listener.fn()
  const patch = readFileSync(PATCH, 'utf8')
  assert.match(patch, /untrusted-bots/)
  assert.match(patch, /bot-sandbox-chat-only/)
})

test('add route rejects packages that are not installed', async () => {
  const response = await route('/api/bot-sandbox/add').fetch(
    request('/api/bot-sandbox/add', { package: 'dsh-not-installed' }),
  )
  assert.equal(response.status, 400)
})

test('add route rejects path traversal dirs and malformed row ids', async () => {
  const traversal = await route('/api/bot-sandbox/add').fetch(
    request('/api/bot-sandbox/add', { package: 'dsh-otherbot', dir: '..\\..\\Windows' }),
  )
  assert.equal(traversal.status, 400)
  const rowInjection = await route('/api/bot-sandbox/add').fetch(
    request('/api/bot-sandbox/add', { package: 'dsh-otherbot', rowId: 'bad id\ninjected: true' }),
  )
  assert.equal(rowInjection.status, 400)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(state.targets.length, 1)
})

test.after(() => {
  if (saved.home === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = saved.home
  if (saved.profile === undefined) delete process.env.DSH_PROFILE_DIR
  else process.env.DSH_PROFILE_DIR = saved.profile
  rmSync(TMP, { recursive: true, force: true })
})
