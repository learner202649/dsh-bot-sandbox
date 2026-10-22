// Pure profile-patch editing helpers. Kept free of YAML/fs imports so they can
// be tested without the host runtime.

/** Find a loader patch row by its stable `id`. */
export function findPatchEntry(entries, id) {
  if (!Array.isArray(entries)) return undefined
  return entries.find((entry) => entry !== null && typeof entry === 'object' && entry.id === id)
}

/**
 * Ensure one target plugin's row carries the sandbox cwd (and optional preset).
 * The entry is created when absent; other keys are preserved verbatim.
 *
 * @returns {boolean} true when something changed.
 */
export function ensureTargetConfig(entries, target) {
  let entry = findPatchEntry(entries, target.rowId)
  let changed = false
  if (entry === undefined) {
    entry = { id: target.rowId, config: {} }
    entries.push(entry)
    changed = true
  }
  const current =
    entry.config !== null && typeof entry.config === 'object' && !Array.isArray(entry.config)
      ? entry.config
      : {}
  const next = { ...current }
  if (next.cwd !== target.cwd) {
    next.cwd = target.cwd
    changed = true
  }
  if (typeof target.preset === 'string' && target.preset !== '' && next.preset !== target.preset) {
    next.preset = target.preset
    changed = true
  }
  if (changed) entry.config = next
  return changed
}

/** Read a target row's current config (for reporting and guard scope). */
export function targetConfigOf(entries, rowId) {
  const entry = findPatchEntry(entries, rowId)
  if (entry === undefined) return {}
  return entry.config !== null && typeof entry.config === 'object' && !Array.isArray(entry.config)
    ? entry.config
    : {}
}
