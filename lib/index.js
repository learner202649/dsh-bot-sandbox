/**
 * dsh-bot-sandbox — host half.
 *
 * Goal: every session created by a configured chat-bot plugin becomes
 * "chat-only" (no host tools), while normal Harness sessions are untouched.
 *
 * DSH has no "session creator plugin" field, so provenance is expressed with a
 * scope token: each target plugin gets its own cwd under
 * `<DSH_HOME>/untrusted-bots/<target>`. The plugin pins that cwd into the
 * profile patch (backup first) and denies every tool/approval whose session
 * `header.cwd` is inside the sandbox root. New sessions created afterwards by
 * the target plugin automatically inherit the pinned cwd.
 *
 * The target list is a JSON file (`<DSH_HOME>/bot-sandbox.json`) managed by the
 * settings panel through same-origin fetch routes, so users never edit YAML.
 */
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { cwdOf, decideTool, isRestrictedCwd } from './policy.js'
import { ensureTargetConfig } from './patch.js'
import { installedTargets, targetDirName } from './detect.js'
import { loadState, saveState, statePath } from './state.js'
import { detectRowId, listCandidates, readPackageJson } from './bundles.js'

export const name = 'bot-sandbox'

// The guard only requires the tool registry. The optional connection service
// serves the settings panel; headless compositions simply skip the routes.
export const inject = ['tools']

const DEFAULT_TARGETS = [
  {
    package: '@tencent-connect/dsh-qqbot',
    rowId: 'im-qqbot',
    dir: 'qqbot',
    preset: 'bot-sandbox-chat-only',
  },
]
const DEFAULT_PRESET = 'bot-sandbox-chat-only'
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const ROW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_DIR_RE = /^[A-Za-z0-9._-]{1,64}$/
const MAX_BODY_BYTES = 64 * 1024

/** Boot diagnostics: one line per apply in %TEMP%, easy to send from a host. */
function debugLog(line) {
  try {
    appendFileSync(join(tmpdir(), 'bot-sandbox-boot.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    // diagnostics must never affect the plugin
  }
}
debugLog('module loaded')

function normalizeConfig(raw) {
  const targets =
    Array.isArray(raw?.targets) && raw.targets.length > 0
      ? raw.targets
          .filter(
            (target) =>
              target !== null &&
              typeof target === 'object' &&
              typeof target.package === 'string' &&
              target.package !== '' &&
              typeof target.rowId === 'string' &&
              target.rowId !== '',
          )
          .map((target) => ({
            package: target.package,
            rowId: target.rowId,
            dir: typeof target.dir === 'string' ? target.dir : '',
            preset: typeof target.preset === 'string' ? target.preset : '',
          }))
      : DEFAULT_TARGETS
  return {
    targets,
    autoApply: raw?.autoApply !== false,
    root: typeof raw?.root === 'string' ? raw.root : '',
    allowTools: Array.isArray(raw?.allowTools) ? raw.allowTools.filter((x) => typeof x === 'string') : [],
    restrictedCwds: Array.isArray(raw?.restrictedCwds)
      ? raw.restrictedCwds.filter((x) => typeof x === 'string' && x !== '')
      : [],
    auditLog: typeof raw?.auditLog === 'string' ? raw.auditLog : '',
  }
}

function resolveHome(profileDir) {
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') return process.env.DSH_HOME
  if (typeof profileDir === 'string' && profileDir !== '') return resolve(profileDir, '..', '..')
  return ''
}

/** Accept a file URL / URL object / plain path from `ctx.baseUrl`. */
function profilePath(baseUrl) {
  if (baseUrl === undefined || baseUrl === null) return undefined
  if (typeof baseUrl === 'object' && typeof baseUrl.href === 'string') {
    try {
      return fileURLToPath(baseUrl)
    } catch {
      return undefined
    }
  }
  if (typeof baseUrl !== 'string' || baseUrl === '') return undefined
  if (baseUrl.startsWith('file:')) {
    try {
      return fileURLToPath(baseUrl)
    } catch {
      return undefined
    }
  }
  return baseUrl
}

/** A directory is a DSH profile only when it declares a profile manifest. */
function isProfileDir(dir) {
  const manifestFile = join(dir, 'package.json')
  if (!existsSync(manifestFile)) return false
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    return Array.isArray(manifest?.dsh?.profile?.bundles)
  } catch {
    return false
  }
}

/** Walk up until a directory that looks like a DSH profile. */
function findProfileRoot(startDir) {
  let dir = startDir
  for (let depth = 0; depth < 10; depth += 1) {
    if (isProfileDir(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/**
 * The host process may not export DSH_PROFILE_DIR/DSH_HOME (the agent session
 * env does, but plugins run in the Electron host). Prefer the env when present,
 * then `ctx.baseUrl` (a file URL of the row/profile), then the installed file's
 * ancestors, and only then cwd.
 */
function resolveProfileDir(ctx) {
  const envDir = process.env.DSH_PROFILE_DIR
  if (typeof envDir === 'string' && envDir !== '' && existsSync(join(envDir, 'package.json'))) return envDir
  const base = profilePath(ctx?.baseUrl)
  if (base !== undefined) {
    const root = findProfileRoot(base)
    if (root !== undefined) return root
    if (existsSync(join(base, 'package.json'))) return base
  }
  try {
    const self = findProfileRoot(dirname(fileURLToPath(import.meta.url)))
    if (self !== undefined) return self
  } catch {
    // ignore
  }
  const cwdRoot = findProfileRoot(process.cwd())
  if (cwdRoot !== undefined) return cwdRoot
  return undefined
}

function resolveRoot(config, home) {
  if (config.root !== '') return config.root
  return home === '' ? '' : join(home, 'untrusted-bots')
}

function readPatchFile(file) {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  if (text.trim() === '') return []
  let parsed
  try {
    parsed = yaml.load(text)
  } catch (error) {
    throw new Error(
      `cordis.patch.yml 解析失败（若文件里用了 !!js 标签，js-yaml 无法解析，暂不自动改写）: ${String(error?.message ?? error)}`,
    )
  }
  if (parsed === null || parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error('cordis.patch.yml top level must be a YAML array')
  return parsed
}

function writePatchFile(file, entries, log) {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${file}.bak.${stamp}-${Math.random().toString(36).slice(2, 8)}`
    copyFileSync(file, backup)
    log.info(`[bot-sandbox] 已备份原 profile patch: ${backup}`)
  }
  const header =
    '# Managed by dsh-bot-sandbox. It pins the cwd (scope token) of restricted bot plugins\n' +
    '# and their chat-only preset. A .bak.<timestamp> copy is written before every change.\n'
  // Write-then-rename so a crash cannot leave the profile patch half-written.
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, header + yaml.dump(entries), 'utf8')
  renameSync(temp, file)
}

/** Pin one target into the profile patch. Returns the desired cwd. */
function applyTarget(target, profileDir, root, log) {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const entries = readPatchFile(patchPath)
  const cwd = join(root, targetDirName(target))
  // The Agent is created with this cwd; DSH refuses a turn when it is missing
  // ("working-directory: directory does not exist"). The sandbox owns the
  // directory, so create it before the next session starts.
  mkdirSync(cwd, { recursive: true })
  const changed = ensureTargetConfig(entries, {
    rowId: target.rowId,
    cwd,
    preset: target.preset,
  })
  if (changed) {
    writePatchFile(patchPath, entries, log)
    log.info(`[bot-sandbox] 已固定 ${target.package}: cwd=${cwd} preset=${target.preset || '(unchanged)'}`)
  }
  return cwd
}

function readAudit(file, limit) {
  if (file === '' || !existsSync(file)) return []
  try {
    const stat = statSync(file)
    const maxBytes = 256 * 1024
    let text
    if (stat.size <= maxBytes) {
      text = readFileSync(file, 'utf8')
    } else {
      // The audit log is append-only and can grow; read only its tail.
      const fd = openSync(file, 'r')
      try {
        const buffer = Buffer.alloc(maxBytes)
        readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes)
        text = buffer.toString('utf8')
      } finally {
        closeSync(fd)
      }
    }
    const lines = text.trim().split('\n').filter(Boolean)
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return undefined
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function makeAudit(file, log) {
  if (file === '') return () => {}
  return (event) => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8')
    } catch (error) {
      log.warn(`[bot-sandbox] 审计写入失败: ${String(error?.message ?? error)}`)
    }
  }
}

function trusted(request) {
  const origin = request.headers.get('origin')
  if (origin === null || origin === '') return true
  try {
    return new URL(origin).host === request.headers.get('host')
  } catch {
    return false
  }
}

function bodyTooLarge(request) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = ctx.logger
  const profileDir = resolveProfileDir(ctx)
  const home = resolveHome(profileDir)
  let root = resolveRoot(config, home)
  if (root !== '' && !isAbsolute(root)) root = resolve(profileDir ?? process.cwd(), root)
  const resolution = `baseUrl=${String(ctx?.baseUrl)} profileDir=${profileDir ?? '(none)'} home=${home || '(none)'} root=${root || '(none)'}`
  debugLog(`apply ${resolution}`)
  log.info(`[bot-sandbox] ${resolution}`)
  if (root === '') {
    debugLog('abort: root unresolved, routes not registered')
    log.warn('[bot-sandbox] 无法解析 DSH_HOME，guard 未启用；请显式设置 config.root')
    return
  }

  const stateFile = home === '' ? '' : statePath(home)
  const auditFile =
    config.auditLog !== ''
      ? config.auditLog
      : home === ''
        ? ''
        : join(home, 'security-watch', 'bot-sandbox.jsonl')
  const audit = makeAudit(auditFile, log)

  // ── target list: UI state file wins; first run seeds it from config ──
  let targets
  const saved = stateFile !== '' ? loadState(stateFile) : undefined
  if (saved !== undefined) {
    targets = saved
  } else {
    const packageJson = profileDir ? readPackageJson(profileDir) : undefined
    targets = (packageJson ? installedTargets(packageJson, config.targets) : config.targets).map((target) => ({
      package: target.package,
      rowId: target.rowId,
      dir: target.dir ?? '',
      preset: target.preset ?? '',
    }))
    if (stateFile !== '') {
      try {
        saveState(stateFile, targets)
        log.info(`[bot-sandbox] 已初始化受控列表: ${stateFile}`)
      } catch (error) {
        log.warn(`[bot-sandbox] 写 ${stateFile} 失败: ${String(error?.message ?? error)}`)
      }
    }
  }

  const runtime = {
    targets,
    config,
    profileDir: profileDir ?? '',
    home,
    root,
    auditFile,
    log,
    scope: new Set(),
  }

  const refreshScope = () => {
    // Scope is exactly the pinned cwd of each controlled target (plus explicit
    // extras). The shared root is only where those cwds live: using the root
    // itself would keep a removed target restricted, so removal could never
    // take effect.
    runtime.scope = new Set(config.restrictedCwds)
    for (const target of runtime.targets) {
      const cwd = join(root, targetDirName(target))
      try {
        mkdirSync(cwd, { recursive: true })
      } catch (error) {
        log.warn(`[bot-sandbox] 创建沙箱目录失败 ${cwd}: ${String(error?.message ?? error)}`)
      }
      runtime.scope.add(cwd)
    }
  }
  refreshScope()

  // ── first-run auto pin + re-pin on plugin enable/reinstall ──
  const reapplyTargets = () => {
    if (runtime.profileDir === '') return
    for (const target of runtime.targets) {
      try {
        applyTarget(target, runtime.profileDir, root, log)
      } catch (error) {
        log.warn(`[bot-sandbox] 固定 ${target.package} 失败: ${String(error?.message ?? error)}`)
      }
    }
    refreshScope()
  }
  if (config.autoApply) reapplyTargets()

  // The protected plugin may be toggled off/on or reinstalled through the
  // plugin manager. Re-pin and reload the persisted target list so the
  // protection comes back without the user touching anything.
  const reloadTargets = () => {
    if (stateFile !== '') {
      const latest = loadState(stateFile)
      if (latest !== undefined) runtime.targets = latest
    }
    refreshScope()
  }
  if (typeof ctx.on === 'function') {
    ctx.on('internal/plugin', (fiber) => {
      try {
        const entryName = fiber?.entry?.options?.name
        if (typeof entryName !== 'string') return
        if (!runtime.targets.some((target) => target.package === entryName)) return
        reloadTargets()
        if (config.autoApply) reapplyTargets()
      } catch (error) {
        log.warn(`[bot-sandbox] 插件挂载后重新固定失败: ${String(error?.message ?? error)}`)
      }
    })
    ctx.on('plugin-manager/changed', () => {
      try {
        reloadTargets()
        if (config.autoApply) reapplyTargets()
      } catch (error) {
        log.warn(`[bot-sandbox] 插件开关后重新固定失败: ${String(error?.message ?? error)}`)
      }
    })
  }

  // ── guard: every tool call from a sandbox cwd is denied ──
  ctx.effect(
    () =>
      ctx.tools.guard((exec) => {
        const cwd = cwdOf(exec.agent)
        const reason = decideTool(exec.name, cwd, {
          restrictedCwds: [...runtime.scope],
          allowTools: config.allowTools,
        })
        if (reason !== undefined) audit({ event: 'tool-denied', tool: exec.name, cwd })
        return reason
      }),
    'bot-sandbox.tools',
  )

  // ── approvals from sandbox sessions are rejected locally, never sent to QQ ──
  ctx.on(
    'approval/request',
    (request, next) => {
      const cwd = cwdOf(request.agent)
      if (!isRestrictedCwd(cwd, [...runtime.scope])) return next()
      audit({ event: 'approval-denied', callId: request.callId, cwd })
      return 'rejected'
    },
    { prepend: true },
  )

  // ── settings panel routes ──
  installRoutes(ctx, runtime, refreshScope)

  log.info(
    `[bot-sandbox] 已启用：受限根=${root}；受控=${runtime.targets.map((t) => t.package).join(', ') || '(none)'}；` +
      `审计=${auditFile === '' ? 'off' : auditFile}`,
  )
}

function installRoutes(ctx, runtime, refreshScope) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['connection'], (child) => {
    const fetchService = child?.connection?.fetch
    if (typeof fetchService?.register !== 'function') return
    const { log, profileDir, root, auditFile } = runtime

    const buildState = (message) => {
      const packageJson = profileDir === '' ? undefined : readPackageJson(profileDir)
      const controlled = new Set(runtime.targets.map((target) => target.package))
      const candidates =
        packageJson === undefined || profileDir === ''
          ? []
          : listCandidates(profileDir, packageJson, controlled)
      return {
        ok: true,
        message: message ?? '',
        root,
        auditFile,
        targets: runtime.targets,
        candidates,
        audit: readAudit(auditFile, 30),
      }
    }

    const replies = (body, status = 200) =>
      Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

    fetchService.register({
      path: '/api/bot-sandbox/state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(replies(buildState())),
    })

    fetchService.register({
      path: '/api/bot-sandbox/add',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (!trusted(request)) return replies({ ok: false, error: 'forbidden' }, 403)
        if (bodyTooLarge(request)) return replies({ ok: false, error: 'body too large' }, 413)
        let body
        try {
          body = await request.json()
        } catch {
          return replies({ ok: false, error: 'invalid-json' }, 400)
        }
        const packageName = String(body?.package ?? '').trim()
        if (!PACKAGE_NAME_RE.test(packageName)) {
          return replies({ ok: false, error: '包名不合法' }, 400)
        }
        if (profileDir === '' || !existsSync(join(profileDir, 'node_modules', packageName))) {
          return replies({ ok: false, error: '这个包没有安装在当前 profile 里' }, 400)
        }
        if (runtime.targets.some((target) => target.package === packageName)) {
          return replies(buildState('已经在受控列表里'))
        }
        let rowId = typeof body?.rowId === 'string' ? body.rowId.trim() : ''
        if (rowId === '') {
          const detected = detectRowId(profileDir, packageName)
          if (detected.rowId === undefined) {
            return replies(
              {
                ok: false,
                error: detected.reason ?? '无法自动确定 loader row id，请手动指定',
                candidates: detected.candidates ?? [],
              },
              400,
            )
          }
          rowId = detected.rowId
        }
        if (!ROW_ID_RE.test(rowId)) {
          return replies({ ok: false, error: 'row id 不合法' }, 400)
        }
        const requestedDir = typeof body?.dir === 'string' ? body.dir.trim() : ''
        if (
          requestedDir !== '' &&
          (requestedDir === '.' || requestedDir === '..' || !SAFE_DIR_RE.test(requestedDir))
        ) {
          return replies({ ok: false, error: 'dir 不合法（只允许单段安全目录名）' }, 400)
        }
        const target = {
          package: packageName,
          rowId,
          dir: requestedDir,
          preset: typeof body?.preset === 'string' && body.preset !== '' ? body.preset : DEFAULT_PRESET,
        }
        // Persist the choice first: even if pinning fails, the guard scope covers
        // the target's sandbox cwd on the next mount instead of silently dropping it.
        runtime.targets.push(target)
        refreshScope()
        if (runtime.home !== '') {
          try {
            saveState(statePath(runtime.home), runtime.targets)
          } catch (error) {
            log.warn(`[bot-sandbox] 保存受控列表失败: ${String(error?.message ?? error)}`)
          }
        }
        try {
          applyTarget(target, profileDir, root, log)
        } catch (error) {
          return replies(
            { ok: false, error: `已加入受控列表，但写入 cwd 失败: ${String(error?.message ?? error)}` },
            500,
          )
        }
        return replies(buildState(`已隔离 ${packageName}；新会话立即生效，旧会话请发 /new`))
      },
    })

    fetchService.register({
      path: '/api/bot-sandbox/remove',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (!trusted(request)) return replies({ ok: false, error: 'forbidden' }, 403)
        if (bodyTooLarge(request)) return replies({ ok: false, error: 'body too large' }, 413)
        let body
        try {
          body = await request.json()
        } catch {
          return replies({ ok: false, error: 'invalid-json' }, 400)
        }
        const packageName = String(body?.package ?? '').trim()
        const before = runtime.targets.length
        runtime.targets = runtime.targets.filter((target) => target.package !== packageName)
        if (runtime.targets.length === before) {
          return replies(buildState('不在受控列表里'))
        }
        refreshScope()
        if (runtime.home !== '') {
          try {
            saveState(statePath(runtime.home), runtime.targets)
          } catch (error) {
            log.warn(`[bot-sandbox] 保存受控列表失败: ${String(error?.message ?? error)}`)
          }
        }
        return replies(buildState(`已取消隔离 ${packageName}（已写入的 cwd 保留，可稍后重新加入）`))
      },
    })

    fetchService.register({
      path: '/api/bot-sandbox/apply',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (!trusted(request)) return replies({ ok: false, error: 'forbidden' }, 403)
        if (profileDir === '') return replies({ ok: false, error: '无法定位 profile' }, 400)
        const failed = []
        for (const target of runtime.targets) {
          try {
            applyTarget(target, profileDir, root, log)
          } catch (error) {
            failed.push({ package: target.package, error: String(error?.message ?? error) })
          }
        }
        refreshScope()
        return replies(buildState(failed.length === 0 ? '已重新应用' : `部分失败: ${JSON.stringify(failed)}`))
      },
    })

    fetchService.register({
      path: '/api/bot-sandbox/audit',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(replies({ ok: true, audit: readAudit(auditFile, 100) })),
    })
  })
}
