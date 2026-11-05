import git from 'isomorphic-git'
import { createGitVault, type GitAuthor, type GitVaultContext } from './gitVault'
import { composeConflictTree } from './gitConflictTree'
import { checkoutGitFastForward } from './gitCheckoutRecovery'
import type { SyncConflictChoices, SyncConflictFile } from '../syncConflictModel'

export type GitConflictReview = { branch: string; local: string; remote: string; base: string; files: SyncConflictFile[] }

export async function inspectGitConflicts(context: GitVaultContext): Promise<GitConflictReview> {
  await createGitVault(context).requireClean()
  const heads = await conflictHeads(context)
  const bases = await git.findMergeBase({ ...context, oids: [heads.local, heads.remote] })
  if (bases.length !== 1) throw new Error('syncConflictAncestry')
  const base = bases[0]
  const { files } = await composeConflictTree(context, [heads.local, base, heads.remote])
  return { ...heads, base, files }
}

export async function resolveGitConflicts(context: GitVaultContext, review: GitConflictReview, choices: SyncConflictChoices, author: GitAuthor) {
  await requireCurrentReview(context, review)
  const result = await composeConflictTree(context, [review.local, review.base, review.remote], choices)
  for (const file of result.files) {
    if (!Object.hasOwn(choices, file.path) || !['local', 'remote', 'both'].includes(choices[file.path])) throw new Error('syncConflictUnresolved')
  }
  const signature = { ...author, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 }
  const oid = await git.writeCommit({ ...context, commit: {
    tree: result.oid, parent: [review.local, review.remote], author: signature, committer: signature,
    message: 'Resolve vault conflicts from Memoria mobile',
  } })
  await requireCurrentReview(context, review)
  await checkoutGitFastForward(context, review.branch, oid)
  return oid
}

async function requireCurrentReview(context: GitVaultContext, review: GitConflictReview) {
  const heads = await conflictHeads(context)
  if (heads.branch !== review.branch || heads.local !== review.local || heads.remote !== review.remote) throw new Error('syncConflictStale')
  try { await createGitVault(context).requireClean() } catch { throw new Error('syncConflictStale') }
}

async function conflictHeads(context: GitVaultContext) {
  const branch = await git.currentBranch(context)
  if (!branch) throw new Error('detachedHead')
  const local = await git.resolveRef({ ...context, ref: 'HEAD' })
  const remote = await git.resolveRef({ ...context, ref: `refs/remotes/origin/${branch}` })
  return { branch, local, remote }
}
