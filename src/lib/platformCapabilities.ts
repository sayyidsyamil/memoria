/**
 * Platform capabilities: which features are available in the current runtime.
 * Web builds hide desktop-only features (git, MCP, updater, multi-window, CLI agents, OpenCode).
 * Desktop shows everything.
 */

import type { VaultBackendKind } from './vaultBackend/types'

export interface PlatformCapabilities {
  /** Git integration (commit, push, pull, branch management) */
  git: boolean
  /** MCP (Model Context Protocol) server integration */
  mcp: boolean
  /** Automatic update checks and downloads */
  updater: boolean
  /** Multi-window support and "New Window" commands */
  multiWindow: boolean
  /** OpenCode integration (open notes in external editors) */
  openCode: boolean
  /** CLI agents (AI agents that run in the terminal) */
  cliAgents: boolean
  /** Per-note editor instances (web: one editor per note for Yjs binding; desktop: single shared editor) */
  perNoteEditors: boolean
  /** Offline read (web): a service worker caches the shell and recent notes, and the vault turns read-only offline */
  offlineRead: boolean
}

/**
 * Derive platform capabilities from the vault backend kind.
 * - `tauri` (desktop): all features available, single shared editor
 * - `mock` (desktop unit tests): all features available, single shared editor
 * - `remote` (web): desktop-only features hidden, per-note editors for Yjs
 */
export function resolvePlatformCapabilities(backendKind: VaultBackendKind): PlatformCapabilities {
  const isDesktop = backendKind === 'tauri' || backendKind === 'mock'

  return {
    git: isDesktop,
    mcp: isDesktop,
    updater: isDesktop,
    multiWindow: isDesktop,
    openCode: isDesktop,
    cliAgents: isDesktop,
    perNoteEditors: !isDesktop,
    offlineRead: backendKind === 'remote',
  }
}

interface RemoteVaultGlobals {
  MEMORIA_REMOTE_URL?: unknown
  MEMORIA_REMOTE_TOKEN?: unknown
}

/** Outside Tauri: the remote backend when a server and token are configured, else mock data. */
export function resolveBrowserBackendKind(scope: RemoteVaultGlobals | undefined = globalThis as RemoteVaultGlobals): 'remote' | 'mock' {
  return scope?.MEMORIA_REMOTE_URL && scope.MEMORIA_REMOTE_TOKEN ? 'remote' : 'mock'
}
