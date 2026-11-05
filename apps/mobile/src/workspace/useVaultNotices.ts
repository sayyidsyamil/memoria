import { useCallback, useReducer } from 'react'
import { emptyVaultNotices, reduceVaultNotices, type VaultNotice } from './vaultNotices'

export function useVaultNotices(scope = '') {
  const [state, dispatch] = useReducer(reduceVaultNotices, emptyVaultNotices)
  const show = useCallback((kind: VaultNotice['kind']) => dispatch({ type: 'show', scope, kind }), [scope])
  const recovered = useCallback(() => dispatch({ type: 'recovered', scope }), [scope])
  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), [])
  return { current: state.current?.scope === scope ? state.current : null, show, recovered, dismiss }
}
