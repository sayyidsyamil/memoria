import git, { type WalkerEntry, type WalkerIterate } from 'isomorphic-git'
import type { GitVaultContext } from './gitVault'

type GitWorkingTreeChange = { filepath: string; deleted: boolean }

/** Read-only guard; the library still owns stat/OID/ignore semantics. */
export async function hasGitWorkingTreeChanges(context: GitVaultContext) {
  return (await scanChanges(context, true)).length > 0
}

export function readGitWorkingTreeChanges(context: GitVaultContext) {
  return scanChanges(context, false)
}

async function scanChanges(context: GitVaultContext, firstOnly: boolean) {
  const changes: GitWorkingTreeChange[] = []
  const iterate: WalkerIterate = async (walk, children) => {
    for (const child of children) {
      if (firstOnly && changes.length) break
      await walk(child)
    }
    return []
  }
  await git.walk({
    ...context,
    trees: [git.TREE({ ref: 'HEAD' }), git.WORKDIR({ refresh: false }), git.STAGE()],
    iterate,
    map: async (filepath, entries) => {
      if (await ignoredUntracked(context, filepath, entries)) return null
      const change = await readChange(filepath, entries)
      if (!change) return change
      changes.push(change)
    },
  })
  return changes
}

function ignoredUntracked(context: GitVaultContext, filepath: string, entries: (WalkerEntry | null)[]) {
  return !entries[0] && !entries[2] && git.isIgnored({ ...context, filepath })
}

async function readChange(filepath: string, entries: (WalkerEntry | null)[]) {
  const types = await Promise.all(entries.map(entry => entry?.type()))
  // Prune gitlinks rather than inspecting their independent working copies.
  if (isGitlink(types)) return null
  if (!types.includes('blob')) return
  // An untracked blob is dirty without reading a potentially large attachment.
  if (!(entries[0] || entries[2])) return { filepath, deleted: false }
  const oids = await Promise.all(entries.map((entry, index) => blobOid(entry, types[index])))
  if (oids.some(oid => oid !== oids[0])) return { filepath, deleted: types[1] !== 'blob' }
}

function isGitlink(types: (string | undefined)[]) {
  return types[0] === 'commit' || types[2] === 'commit'
}

function blobOid(entry: WalkerEntry | null, type: string | undefined) {
  return type === 'blob' ? entry?.oid() : undefined
}
