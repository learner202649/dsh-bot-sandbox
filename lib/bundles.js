// Bundle discovery for the sandbox UI: list installed bundles in the current
// profile and resolve the loader row id a package contributes, by reading its
// declared `dsh.bundle.patch`.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import yaml from 'js-yaml'

export function packageDir(profileDir, name) {
  return join(profileDir, 'node_modules', name)
}

export function readPackageJson(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Absolute path of a package's declared bundle patch, or undefined. */
export function bundlePatchFile(profileDir, name) {
  const manifest = readPackageJson(packageDir(profileDir, name))
  const patch = manifest?.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch === '') return undefined
  return isAbsolute(patch) ? patch : join(packageDir(profileDir, name), patch)
}

/** Flatten `- insert: [...]` rows and plain rows of one bundle patch. */
export function flattenPatchRows(document) {
  const rows = []
  if (!Array.isArray(document)) return rows
  for (const row of document) {
    if (row === null || typeof row !== 'object') continue
    if (Array.isArray(row.insert)) {
      for (const inserted of row.insert) {
        if (inserted !== null && typeof inserted === 'object') rows.push(inserted)
      }
    } else if (typeof row.id === 'string') {
      rows.push(row)
    }
  }
  return rows
}

/**
 * Find the loader row a package declares for itself. Most bot plugins insert a
 * row whose `name` is the package name; ambiguity is reported instead of guessed.
 * @returns {{rowId?: string, candidates?: string[], reason?: string}}
 */
export function detectRowId(profileDir, name) {
  const file = bundlePatchFile(profileDir, name)
  if (file === undefined) return { reason: '该插件没有声明 dsh.bundle.patch' }
  let document
  try {
    document = yaml.load(readFileSync(file, 'utf8'))
  } catch (error) {
    return { reason: `bundle patch 解析失败: ${String(error?.message ?? error)}` }
  }
  const rows = flattenPatchRows(document).filter((row) => row.name === name)
  if (rows.length === 1) return { rowId: rows[0].id }
  if (rows.length > 1) return { candidates: rows.map((row) => row.id) }
  return { reason: `bundle patch 里没有 name 为 ${name} 的行` }
}

/** Installed bundles of this profile, with the marker the UI needs. */
export function listCandidates(profileDir, packageJson, controlledPackages) {
  const names = new Set()
  for (const name of Object.keys(packageJson?.dependencies ?? {})) names.add(name)
  for (const name of packageJson?.dsh?.profile?.bundles ?? []) names.add(name)
  const candidates = []
  for (const name of names) {
    const manifest = readPackageJson(packageDir(profileDir, name))
    const hasBundle = typeof manifest?.dsh?.bundle?.patch === 'string'
    if (!hasBundle) continue
    const description = typeof manifest.description === 'string' ? manifest.description : ''
    candidates.push({
      package: name,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      description,
      // A hint for the UI only: chat-bot plugins usually say so in their name or
      // description. Non-hinted bundles stay addable through manual entry, but
      // the one-click list does not invite grabbing unrelated feature plugins.
      botLike: /(qqbot|chatbot|chat[-_]?bot|\bbot\b|telegram|discord|slack|wechat|wecom|dingtalk|feishu|lark|matrix|im[-_])/i.test(
        `${name} ${description}`,
      ),
      controlled: controlledPackages.has(name),
      row: detectRowId(profileDir, name),
    })
  }
  candidates.sort((a, b) => Number(b.botLike) - Number(a.botLike) || a.package.localeCompare(b.package))
  return candidates
}
