import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubMediaQueries } from '../test-utils/mediaQueries'
import { useAppWindowControls } from './useAppWindowControls'
import type { useLayoutPanels } from './useLayoutPanels'
import { TABLET_LAYOUT_QUERY } from './useTabletSidebar'

vi.mock('./useMainWindowSizeConstraints', () => ({
  applyMainWindowSizeConstraints: vi.fn(() => Promise.resolve()),
  getMainWindowMinWidth: vi.fn(() => 0),
  useMainWindowSizeConstraints: vi.fn(),
}))

const layout = {
  inspectorCollapsed: true,
  inspectorWidth: 280,
  noteListWidth: 300,
  setInspectorCollapsed: vi.fn(),
  sidebarWidth: 250,
} as unknown as ReturnType<typeof useLayoutPanels>

function renderControls() {
  return renderHook(() => useAppWindowControls({ layout, windowMode: false }))
}

describe('useAppWindowControls on a tablet (TOL-194)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('starts with two panes and expands and collapses the sidebar for the session', () => {
    const { result } = renderControls()
    expect(result.current.sidebarVisible).toBe(false)
    expect(result.current.noteListVisible).toBe(true)

    act(() => { result.current.handleSetViewMode('all') })
    expect(result.current.sidebarVisible).toBe(true)

    act(() => { result.current.handleCollapseSidebar() })
    expect(result.current.sidebarVisible).toBe(false)
    expect(result.current.noteListVisible).toBe(true)
  })

  it('collapses the sidebar through the view mode off the tablet', () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', '')
    const { result } = renderControls()
    expect(result.current.sidebarVisible).toBe(true)

    act(() => { result.current.handleCollapseSidebar() })
    expect(result.current.sidebarVisible).toBe(false)
    act(() => { result.current.handleSetViewMode('all') })
    expect(result.current.sidebarVisible).toBe(true)
  })
})
