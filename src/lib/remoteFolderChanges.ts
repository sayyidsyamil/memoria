import { useEffect, useRef } from 'react'
import { isPortableName } from '../utils/portableName'
import { hasRemoteVault } from './vaultBackend'

/**
 * Folder creates and deletes made in one tab of a Memoria remote, told to the other tabs of
 * the same origin so their folder tree, note list and tabs follow without a reload. The
 * server already made the change in one commit; this only says that it happened.
 */

export interface RemoteFolderChange {
  kind: 'created' | 'deleted'
  /** Vault-relative path of the folder. */
  path: string
}

type FolderChangeListener = (change: RemoteFolderChange) => void

const CHANNEL_PREFIX = 'memoria:remote-folders:'
const listeners = new Set<FolderChangeListener>()
// One channel per page: a message never comes back to the channel that posted it.
let channel: BroadcastChannel | null = null

/**
 * A vault-relative folder path whose every segment is a name the folder actions accept
 * (`isPortableName`): not absolute, no empty, `.` or `..` segment, no backslash.
 */
function isVaultFolderPath(path: unknown): path is string {
  return typeof path === 'string' && path.split('/').every(isPortableName)
}

function isFolderChange(value: unknown): value is RemoteFolderChange {
  const change = value as Partial<RemoteFolderChange> | null
  const knownKind = change?.kind === 'created' || change?.kind === 'deleted'
  return knownKind && isVaultFolderPath(change?.path)
}

/** Tabs of the same remote vault share a channel; another vault served on this origin has its own. */
export function remoteFolderChannelName(): string {
  const { MEMORIA_REMOTE_URL: serverUrl = '' } = window as { MEMORIA_REMOTE_URL?: string }
  return `${CHANNEL_PREFIX}${serverUrl}`
}

function pageChannel(): BroadcastChannel | null {
  if (!hasRemoteVault() || typeof BroadcastChannel === 'undefined') return null
  if (channel) return channel
  channel = new BroadcastChannel(remoteFolderChannelName())
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (!isFolderChange(data)) return
    for (const listener of listeners) listener(data)
  }
  return channel
}

/** Tells the other tabs on this remote that a folder was created or deleted here. */
export function announceRemoteFolderChange(change: RemoteFolderChange): void {
  pageChannel()?.postMessage(change)
}

/** Calls `onChange` for every folder create or delete another tab on this remote made. */
export function useRemoteFolderChanges(onChange: FolderChangeListener): void {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!pageChannel()) return
    const listener: FolderChangeListener = (change) => onChangeRef.current(change)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
}
