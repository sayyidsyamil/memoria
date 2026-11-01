import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application'
import * as files from 'expo-file-system/legacy'
import type { SnapshotCacheStorage } from './workspaceSnapshotCache'

const root = files.cacheDirectory ? `${files.cacheDirectory}memoria-workspace-snapshots/` : null
const maxBytes = 32 * 1024 * 1024

export const workspaceSnapshotStorage: SnapshotCacheStorage = {
  revision: `${nativeApplicationVersion ?? 'development'}:${nativeBuildVersion ?? 'development'}`,
  digest: text => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
  read: async key => {
    const uri = cacheUri(key)
    const info = await files.getInfoAsync(uri)
    if (!info.exists || info.isDirectory || info.size > maxBytes) return null
    return files.readAsStringAsync(uri)
  },
  write: async (key, value) => {
    const uri = cacheUri(key)
    if (!root || value.length > maxBytes / 3) return
    await files.makeDirectoryAsync(root, { intermediates: true })
    await files.writeAsStringAsync(uri, value)
    await pruneCaches(uri)
  },
}

function cacheUri(key: string) {
  if (!root || !/^[a-f0-9]{64}$/u.test(key)) throw new Error('invalidSnapshotCacheKey')
  return `${root}${key}.json`
}

async function pruneCaches(current: string) {
  if (!root) return
  const entries = await knownCacheEntries(root)
  entries.sort((a, b) => Number(b.uri === current) - Number(a.uri === current) || b.modified - a.modified)
  let retainedBytes = 0
  for (const [index, entry] of entries.entries()) {
    if (index >= 3 || retainedBytes + entry.size > maxBytes) await files.deleteAsync(entry.uri, { idempotent: true })
    else retainedBytes += entry.size
  }
}

async function knownCacheEntries(directory: string) {
  const entries: { uri: string; modified: number; size: number }[] = []
  for (const name of await files.readDirectoryAsync(directory)) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
    const entry = await cacheEntry(`${directory}${name}`)
    if (entry) entries.push(entry)
  }
  return entries
}

async function cacheEntry(uri: string) {
  const info = await files.getInfoAsync(uri)
  return info.exists && !info.isDirectory ? { uri, modified: info.modificationTime, size: info.size } : null
}
