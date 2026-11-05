import git, { type WalkerIterate } from 'isomorphic-git'
import type { GitVaultContext } from './gitVault'
import { createGitTaskRunner } from './gitTaskRunner'

type Entry = { path: string; oid: string; tree: boolean }

/** isomorphic-git's checkout planner does not execute file/directory swaps. */
export async function prepareGitTypeChanges(context: GitVaultContext, before: string, target: string) {
  const swaps: Entry[] = []
  const tasks = createGitTaskRunner()
  const iterate: WalkerIterate = async (walk, children) => {
    for (const child of children) await tasks.run(() => walk(child))
    return []
  }
  await git.walk({ ...context, trees: [git.TREE({ ref: before }), git.TREE({ ref: target })],
    iterate,
    map: async (path, [old, next]) => {
      if (!old || !next) return null
      // Only immutable commit-tree identities can justify pruning this walk.
      if (await old.oid() === await next.oid()) return null
      if (path === '.') return
      const previousType = await old.type()
      const nextType = await next.type()
      if (previousType === nextType) return
      swaps.push({ path, oid: await old.oid(), tree: previousType === 'tree' })
      return null
    },
  })
  for (const swap of swaps) await prepareSwap(context, swap)
}

async function prepareSwap(context: GitVaultContext, entry: Entry) {
  const absolute = `${context.dir}/${entry.path}`
  const stat = await existingStat(context, absolute)
  // An interrupted attempt may already have removed the old entry or created its replacement.
  if (stat?.isSymbolicLink()) throw new Error('checkoutRecoveryChangedFile')
  if (stat && stat.isDirectory() !== entry.tree) return
  if (stat) {
    await requireOriginal(context, entry)
    await removeOriginal(context, entry)
  }
  await clearOldIndex(context, entry)
}

async function clearOldIndex(context: GitVaultContext, entry: Entry) {
  for (const path of await git.listFiles(context)) {
    if (path === entry.path || path.startsWith(`${entry.path}/`)) await git.remove({ ...context, filepath: path })
  }
}

async function requireOriginal(context: GitVaultContext, entry: Entry): Promise<void> {
  const absolute = `${context.dir}/${entry.path}`
  const stat = await existingStat(context, absolute)
  if (!stat) return
  if (stat.isSymbolicLink() || stat.isDirectory() !== entry.tree) throw new Error('checkoutRecoveryChangedFile')
  if (!entry.tree) {
    await requireOriginalBlob(context, entry)
    return
  }
  await requireOriginalTree(context, entry)
}

async function requireOriginalBlob(context: GitVaultContext, entry: Entry) {
  const object = await filesystem(context).readFile(`${context.dir}/${entry.path}`)
  if ((await git.hashBlob({ object })).oid !== entry.oid) throw new Error('checkoutRecoveryChangedFile')
}

async function requireOriginalTree(context: GitVaultContext, entry: Entry) {
  const children = await childEntries(context, entry)
  await requireKnownChildren(context, entry.path, children)
  for (const child of children) await requireOriginal(context, child)
}

async function requireKnownChildren(context: GitVaultContext, parent: string, expected: Entry[]) {
  const actual: string[] = await filesystem(context).readdir(`${context.dir}/${parent}`)
  const known = new Set(expected.map(child => child.path))
  if (actual.some(name => !known.has(`${parent}/${name}`))) throw new Error('checkoutRecoveryChangedFile')
}

async function childEntries(context: GitVaultContext, entry: Entry): Promise<Entry[]> {
  const children = (await git.readTree({ ...context, oid: entry.oid })).tree
  return children.map(child => ({ path: `${entry.path}/${child.path}`, oid: child.oid, tree: child.type === 'tree' }))
}

async function removeOriginal(context: GitVaultContext, entry: Entry): Promise<void> {
  const absolute = `${context.dir}/${entry.path}`
  if (entry.tree) {
    await removeOriginalDirectory(context, entry)
    return
  }
  if (await existingStat(context, absolute)) await filesystem(context).unlink(absolute)
  await git.remove({ ...context, filepath: entry.path })
}

async function removeOriginalDirectory(context: GitVaultContext, entry: Entry) {
  for (const child of await childEntries(context, entry)) await removeOriginal(context, child)
  const absolute = `${context.dir}/${entry.path}`
  if (await existingStat(context, absolute)) await filesystem(context).rmdir(absolute)
}

async function existingStat(context: GitVaultContext, path: string) {
  try { return await filesystem(context).lstat(path) } catch (error) {
    if (missingFile(error)) return null
    throw error
  }
}

function missingFile(error: unknown) { return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' }

function filesystem({ fs }: GitVaultContext) {
  if (!('promises' in fs)) throw new Error('asyncGitFileSystemRequired')
  return fs.promises
}
