import git, { type WalkerEntry } from 'isomorphic-git'
import { Buffer } from 'buffer'
import type { GitAuthor, GitVaultContext } from './gitVault'
import { validMergedMetadata } from './gitMergeValidation'

/** Build objects only. The existing checkout journal publishes a successful merge. */
export async function mergeGitHeads(context: GitVaultContext, remote: string, author: GitAuthor) {
  const local = await git.resolveRef({ ...context, ref: 'HEAD' })
  const bases = await git.findMergeBase({ ...context, oids: [local, remote] })
  if (bases.length !== 1 || !await mergeableBlobs(context, [local, remote, bases[0]])) return null
  const merged = await writeMergedCommit(context, remote, author)
  return merged && await validMergedMetadata(context, merged, local, remote) ? merged : null
}

async function writeMergedCommit(context: GitVaultContext, remote: string, author: GitAuthor) {
  try {
    const result = await git.merge({
      ...context, theirs: remote, author, committer: author,
      noUpdateBranch: true, abortOnConflict: true, allowUnrelatedHistories: false,
    })
    if (!result.oid) throw new Error('mergeCommitMissing')
    return result.oid
  } catch (error) {
    if (error instanceof git.Errors.MergeConflictError || error instanceof git.Errors.MergeNotSupportedError) return null
    throw error
  }
}

async function mergeableBlobs(context: GitVaultContext, refs: string[]) {
  let safe = true
  await git.walk({
    ...context, trees: refs.map(ref => git.TREE({ ref })),
    map: async (_path, entries) => { if (!await mergeableEntry(entries)) safe = false },
  })
  return safe
}

async function mergeableEntry([ours, theirs, base]: (WalkerEntry | null)[]) {
  if (!ours || !theirs || await ours.type() !== 'blob' || await theirs.type() !== 'blob') return true
  const left = await ours.oid()
  const right = await theirs.oid()
  const ancestor = await base?.oid()
  if (left === right || left === ancestor || right === ancestor) return true
  // The library's diff3 driver decodes UTF-8; reject lossy conversion before it runs.
  for (const entry of [ours, theirs, base]) {
    if (!entry || await entry.type() !== 'blob') continue
    const content = await entry.content()
    if (!content) throw new Error('mergeBlobMissing')
    const bytes = Buffer.from(content)
    if (bytes.includes(0) || !bytes.equals(Buffer.from(bytes.toString('utf8')))) return false
  }
  return true
}
