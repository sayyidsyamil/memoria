// @vitest-environment jsdom
import { act, createElement, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MobileVaultControlsContext, MobileVaultDisplayContext } from '../../workspace/MobileVaultContext'
import { MobilePendingNoteIndicator } from './MobilePendingNoteIndicator'

vi.mock('react-native', () => ({ View: (props: { testID?: string; accessibilityLabel?: string; style?: CSSProperties }) =>
  createElement('span', { 'data-testid': props.testID, 'aria-label': props.accessibilityLabel, style: props.style }) }))
vi.mock('../../ui/theme/useMobileTheme', () => ({ useMobileColors: () => ({ yellow: '#eab308' }) }))
vi.mock('../../i18n/mobileText', () => ({ mobileText: (key: string) => key }))
afterEach(() => vi.unstubAllGlobals())

async function renderIndicator({ git = true, linked = false, rootUri = 'file:///owned', path = 'folder/note.md',
  pending = ['folder'] }: { git?: boolean; linked?: boolean; rootUri?: string; path?: string; pending?: string[] } = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const controls = { rootUri: 'file:///owned', git, linked, busy: false, status: 'pending' as const,
    pendingNotePaths: new Set(pending), open: async () => {}, sync: async () => {} }
  await act(async () => root.render(createElement(MobileVaultControlsContext.Provider, { value: controls },
    createElement(MobileVaultDisplayContext.Provider, { value: { source: 'native', rootUri } },
      createElement(MobilePendingNoteIndicator, { note: { id: path, path } })),
  )))
  return { marker: () => container.querySelector('[data-testid]'), close: () => act(async () => root.unmount()) }
}

it('shows a yellow status marker for a changed note or renamed parent folder', async () => {
  const view = await renderIndicator()
  try {
    expect(view.marker()?.getAttribute('aria-label')).toBe('mobile.sync.pendingShort')
    expect(view.marker()?.getAttribute('style')).toContain('rgb(234, 179, 8)')
  } finally { await view.close() }
})

it.each([
  { git: false, linked: false },
  { rootUri: 'file:///different-vault' },
  { path: 'other.md' },
  { pending: [] },
])('does not mark unrelated, clean, or unconnected notes: %j', async options => {
  const view = await renderIndicator(options)
  try { expect(view.marker()).toBeNull() } finally { await view.close() }
})

it('also marks a pending note in a linked local folder', async () => {
  const view = await renderIndicator({ git: false, linked: true })
  try { expect(view.marker()).not.toBeNull() } finally { await view.close() }
})
