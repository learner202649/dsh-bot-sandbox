// Pure detection helpers: is a configured bot package actually installed in
// the current profile, and what directory should it be pinned to?

/** Collect the package names a profile declares as dependencies or bundles. */
export function profilePackages(packageJson) {
  const deps = packageJson?.dependencies
  const bundles = packageJson?.dsh?.profile?.bundles
  const names = new Set()
  if (deps !== null && typeof deps === 'object') {
    for (const name of Object.keys(deps)) names.add(name)
  }
  if (Array.isArray(bundles)) {
    for (const name of bundles) if (typeof name === 'string') names.add(name)
  }
  return names
}

/** Filter the configured targets down to those installed in this profile. */
export function installedTargets(packageJson, targets) {
  const names = profilePackages(packageJson)
  return (Array.isArray(targets) ? targets : []).filter(
    (target) => target !== null && typeof target === 'object' && names.has(target.package),
  )
}

/** Safe single path segment for a sandbox subdirectory. */
const SAFE_DIR_RE = /^[A-Za-z0-9._-]{1,64}$/

/** Directory name used under the sandbox root for one target. */
export function targetDirName(target) {
  const requested = typeof target?.dir === 'string' ? target.dir.trim() : ''
  // A `dir` comes from config or the settings API; never let it escape the root.
  if (requested !== '' && requested !== '.' && requested !== '..' && SAFE_DIR_RE.test(requested)) {
    return requested
  }
  const pkg = typeof target?.package === 'string' ? target.package : 'bot'
  return pkg
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .toLowerCase()
}
