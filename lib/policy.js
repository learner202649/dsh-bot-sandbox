// Pure path/policy helpers. Dependency-free so the rules are unit-testable
// without booting a Cordis host.
//
// The scope token is the Session's `header.cwd`: DSH's session-creation API has
// no "creator plugin" field, so every restricted bot plugin is pinned to its own
// cwd under one root. A session is considered "remote" iff its cwd is inside
// that root. Normal Harness sessions keep their own workspace cwd and are never
// matched.

/** Normalize a Windows or POSIX path for comparison. */
export function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  return value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** Read the working directory recorded on an Agent's Session header. */
export function cwdOf(agent) {
  const session = agent?.session
  return (
    session?.header?.cwd ??
    session?.meta?.cwd ??
    session?.cwd ??
    agent?.meta?.cwd ??
    undefined
  )
}

/** True when `cwd` is `root` itself or a descendant of it. */
export function isRestrictedCwd(cwd, restrictedCwds) {
  const target = normalizePath(cwd)
  if (target === '') return false
  for (const root of restrictedCwds ?? []) {
    const base = normalizePath(root)
    if (base === '') continue
    if (target === base || target.startsWith(base + '\\')) return true
  }
  return false
}

/**
 * Decide whether a tool call from `cwd` is allowed.
 * @returns {string | undefined} denial reason, or undefined to allow.
 */
export function decideTool(toolName, cwd, config) {
  if (!isRestrictedCwd(cwd, config?.restrictedCwds)) return undefined
  const allow = new Set(config?.allowTools ?? [])
  if (allow.has(toolName)) return undefined
  return `bot-sandbox: 该会话由受限机器人插件创建，禁止调用工具 "${toolName}"`
}
