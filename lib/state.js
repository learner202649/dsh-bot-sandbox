// Persistent target list for the bot sandbox. Kept as a small JSON file under
// DSH_HOME so the UI can add/remove plugins without editing any YAML.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SAFE_DIR_RE = /^[A-Za-z0-9._-]{1,64}$/
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const ROW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function statePath(dshHome) {
  return join(dshHome, 'bot-sandbox.json')
}

/** @returns {{package: string, rowId: string, dir: string, preset: string}[] | undefined} */
export function loadState(file) {
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed?.targets)) return undefined
    return parsed.targets
      .filter(
        (target) =>
          target !== null &&
          typeof target === 'object' &&
          typeof target.package === 'string' &&
          PACKAGE_NAME_RE.test(target.package) &&
          typeof target.rowId === 'string' &&
          ROW_ID_RE.test(target.rowId),
      )
      .map((target) => ({
        package: target.package,
        rowId: target.rowId,
        // Drop an unsafe dir instead of persisting a path that could escape root.
        dir:
          typeof target.dir === 'string' &&
          target.dir !== '.' &&
          target.dir !== '..' &&
          SAFE_DIR_RE.test(target.dir)
            ? target.dir
            : '',
        preset: typeof target.preset === 'string' ? target.preset : '',
      }))
  } catch {
    return undefined
  }
}

export function saveState(file, targets) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, JSON.stringify({ version: 1, targets }, undefined, 2) + '\n', 'utf8')
  renameSync(temp, file)
}
