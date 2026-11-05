import git from 'isomorphic-git'
import { Buffer } from 'buffer'
import type { GitVaultContext } from './gitVault'

/** Keep the complete working tree, retrieving older history only when a merge needs it. */
export async function ensureGitMergeHistory(context: GitVaultContext, remote: string, deepen: (boundaries: string[]) => Promise<string>) {
  const local = await git.resolveRef({ ...context, ref: 'HEAD' })
  let boundary = await shallowBoundary(context)
  while (boundary && !(await git.findMergeBase({ ...context, oids: [local, remote] })).length) {
    remote = await deepen(boundary.split('\n'))
    const next = await shallowBoundary(context)
    if (next === boundary) throw new Error('gitHistoryUnavailable')
    boundary = next
  }
  return remote
}

async function shallowBoundary({ fs, dir }: GitVaultContext) {
  if (!('promises' in fs)) throw new Error('asyncGitFileSystemRequired')
  try {
    return Buffer.from(await fs.promises.readFile(`${dir}/.git/shallow`)).toString('utf8').trim()
  } catch (error) {
    if (isMissing(error)) return ''
    throw error
  }
}

function isMissing(error: unknown) {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
