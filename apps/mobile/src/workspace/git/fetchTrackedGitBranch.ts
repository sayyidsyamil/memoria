import git from 'isomorphic-git'

type FetchOptions = Parameters<typeof git.fetch>[0] & { ref: string }

/** Negotiate with a known remote tip, not a local commit the server has never seen. */
export async function fetchTrackedGitBranch(options: FetchOptions) {
  const { fs, dir, gitdir, ref } = options
  const remote = options.remote || await git.getConfig({ fs, dir, gitdir, path: `branch.${ref}.remote` })
  const upstream = options.remoteRef || await git.getConfig({ fs, dir, gitdir, path: `branch.${ref}.merge` })
  const selection = usesManagedUpstream(remote, upstream, ref)
    ? { ref: `refs/remotes/origin/${ref}`, remoteRef: `refs/heads/${ref}` } : {}
  return git.fetch({ ...options, ...selection, singleBranch: true, tags: false })
}

function usesManagedUpstream(remote: unknown, upstream: unknown, ref: string) {
  return (!remote || remote === 'origin') && (!upstream || upstream === `refs/heads/${ref}`)
}
