import { expect, it } from 'vitest'
import { emptyVaultNotices, reduceVaultNotices } from './vaultNotices'

it('shows a bounded failure category without exposing the underlying error', () => {
  const state = reduceVaultNotices(emptyVaultNotices, { type: 'show', scope: 'local-one', kind: 'conflict' })
  expect(state.current).toEqual({ scope: 'local-one', kind: 'conflict' })
})

it('does not repeat a dismissed failure on each automatic retry', () => {
  const event = { type: 'show', scope: 'local-one', kind: 'retry' } as const
  const shown = reduceVaultNotices(emptyVaultNotices, event)
  const dismissed = reduceVaultNotices(shown, { type: 'dismiss' })
  expect(reduceVaultNotices(dismissed, event)).toBe(dismissed)
  expect(dismissed.current).toBeNull()
})

it('allows a new error category and keeps failures independent between vaults', () => {
  const first = reduceVaultNotices(emptyVaultNotices, { type: 'show', scope: 'first', kind: 'retry' })
  const second = reduceVaultNotices(first, { type: 'show', scope: 'second', kind: 'retry' })
  const auth = reduceVaultNotices(second, { type: 'show', scope: 'second', kind: 'authentication' })
  expect(auth.current).toEqual({ scope: 'second', kind: 'authentication' })
  const recovered = reduceVaultNotices(auth, { type: 'recovered', scope: 'first' })
  expect(recovered.current).toBe(auth.current)
  expect(reduceVaultNotices(recovered, { type: 'show', scope: 'second', kind: 'retry' })).toBe(recovered)
})

it('permits another notification after a successful sync resolves the previous episode', () => {
  const event = { type: 'show', scope: 'first', kind: 'local' } as const
  const failed = reduceVaultNotices(emptyVaultNotices, event)
  const recovered = reduceVaultNotices(failed, { type: 'recovered', scope: 'first' })
  expect(recovered.current).toBeNull()
  expect(reduceVaultNotices(recovered, event).current).toEqual({ scope: 'first', kind: 'local' })
})

it('bounds session history without storing raw errors or vault contents', () => {
  let state = emptyVaultNotices
  for (let index = 0; index < 100; index++) {
    state = reduceVaultNotices(state, { type: 'show', scope: `vault-${index}`, kind: 'retry' })
  }
  expect(state.seen).toHaveLength(32)
})
