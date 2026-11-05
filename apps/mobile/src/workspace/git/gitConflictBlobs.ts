import git, { type TreeEntry } from 'isomorphic-git'
import { Buffer } from 'buffer'
import diff3 from 'diff3'
import type { GitVaultContext } from './gitVault'
import type { SyncConflictVersion } from '../syncConflictModel'
import { validSyncMetadata } from './gitMergeValidation'

export async function mergeConflictBlobs(context: GitVaultContext, path: string, entries: (TreeEntry | undefined)[]) {
  if (!entries.every(regularBlob)) return undefined
  const contents: string[] = []
  for (const entry of entries) {
    const text = await blobText(context, entry)
    if (text === null || text.length > 1_000_000) return undefined
    contents.push(text)
  }
  const [local, base, remote] = contents.map(lines)
  const chunks = diff3(local, base, remote)
  if (chunks.some(chunk => 'conflict' in chunk)) return undefined
  const text = chunks.flatMap(chunk => 'ok' in chunk ? chunk.ok : []).join('')
  if (!validSyncMetadata(path, text)) return undefined
  return git.writeBlob({ ...context, blob: Buffer.from(text) })
}

function regularBlob(entry: TreeEntry | undefined) { return entry?.type === 'blob' && entry.mode === '100644' }
function lines(text: string) { return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [] }

export async function conflictVersion(context: GitVaultContext, entry: TreeEntry | undefined): Promise<SyncConflictVersion> {
  if (!entry) return { kind: 'deleted', text: '', truncated: false }
  const text = await blobText(context, entry)
  if (text === null) return { kind: 'binary', text: '', truncated: false }
  return { kind: 'text', text: text.slice(0, 32000), truncated: text.length > 32000 }
}

async function blobText(context: GitVaultContext, entry: TreeEntry | undefined) {
  if (entry?.type !== 'blob') return null
  const bytes = Buffer.from((await git.readBlob({ ...context, oid: entry.oid })).blob)
  const text = bytes.toString('utf8')
  return bytes.includes(0) || !bytes.equals(Buffer.from(text)) ? null : text
}
