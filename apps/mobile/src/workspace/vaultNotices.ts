import type { SyncFailureKind } from './syncFailure'

export type VaultNotice = { scope: string; kind: SyncFailureKind | 'saveFailed' }
export type VaultNotices = { current: VaultNotice | null; seen: VaultNotice[] }
export type VaultNoticeEvent =
  | ({ type: 'show' } & VaultNotice)
  | { type: 'dismiss' }
  | { type: 'recovered'; scope: string }

export const emptyVaultNotices: VaultNotices = { current: null, seen: [] }

export function reduceVaultNotices(state: VaultNotices, event: VaultNoticeEvent): VaultNotices {
  if (event.type === 'dismiss') return { ...state, current: null }
  if (event.type === 'recovered') return {
    current: state.current?.scope === event.scope ? null : state.current,
    seen: state.seen.filter(notice => notice.scope !== event.scope),
  }
  if (state.seen.some(notice => notice.scope === event.scope && notice.kind === event.kind)) return state
  const current = { scope: event.scope, kind: event.kind }
  return { current, seen: [...state.seen.slice(-31), current] }
}
