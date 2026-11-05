import { createExpoGitFileSystem } from './expoGitFileSystem'

let recent: { rootUri: string; fs: ReturnType<typeof createExpoGitFileSystem> } | undefined

/** Retain path handles only; every operation still reads fresh filesystem state. */
export function gitFileSystemSession(rootUri: string) {
  if (recent?.rootUri === rootUri) return recent.fs
  const fs = createExpoGitFileSystem(rootUri)
  recent = { rootUri, fs }
  return fs
}
