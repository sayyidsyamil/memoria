import git, { type WalkerEntry } from 'isomorphic-git'
import { Buffer } from 'buffer'
import { parseDocument } from 'yaml'
import { parseMobileViewDefinition } from '../mobileViewYaml'
import type { GitVaultContext } from './gitVault'

/** Only inspect synthesized blobs; unrelated legacy metadata is not rewritten. */
export async function validMergedMetadata(context: GitVaultContext, merged: string, local: string, remote: string) {
  let valid = true
  await git.walk({
    ...context, trees: [merged, local, remote].map(ref => git.TREE({ ref })),
    map: async (path, entries) => { if (!await validMergedEntry(path, entries)) valid = false },
  })
  return valid
}

async function validMergedEntry(path: string, [result, ours, theirs]: (WalkerEntry | null)[]) {
  if (!result || await result.type() !== 'blob') return true
  const oid = await result.oid()
  if (oid === await ours?.oid() || oid === await theirs?.oid()) return true
  const content = await result.content()
  return content !== undefined && validSyncMetadata(path, Buffer.from(content).toString('utf8'))
}

export function validSyncMetadata(path: string, content: string) {
  try {
    if (/^views\/.*\.ya?ml$/i.test(path)) return parseMobileViewDefinition(content, path) !== null
    if (/^config\/.*\.json$/i.test(path)) return isMapping(JSON.parse(content))
    if (!/\.md$/i.test(path)) return true
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
    if (lines[0]?.trimEnd() !== '---') return true
    const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
    return end > 0 && validFrontmatter(lines.slice(1, end).join('\n'))
  } catch { return false }
}

function validFrontmatter(source: string) {
  if (source.length > 262_144) return false
  const document = parseDocument(source, { schema: 'core', strict: true, prettyErrors: false })
  if (document.errors.length || document.warnings.length) return false
  const value: unknown = document.toJS({ maxAliasCount: 32 })
  return value === null || isMapping(value)
}

function isMapping(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
