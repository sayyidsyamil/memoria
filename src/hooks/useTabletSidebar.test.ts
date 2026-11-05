import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubMediaQueries } from '../test-utils/mediaQueries'
import { TABLET_LAYOUT_ATTRIBUTE, TABLET_LAYOUT_QUERY, useTabletSidebar } from './useTabletSidebar'

const PORTRAIT = '(orientation: portrait)'

function renderSidebar(enabled = true, sidebarVisible = true) {
  return renderHook((props) => useTabletSidebar(props), { initialProps: { enabled, sidebarVisible } })
}

function tapOn(element: Element) {
  act(() => { element.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
}

function renderShell() {
  document.body.innerHTML = '<div class="app"><div class="app__sidebar"><button id="type"></button></div><div id="list"></div></div><div id="menu"></div>'
  return (id: string) => document.getElementById(id) as HTMLElement
}

describe('useTabletSidebar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('collapses the sidebar on a tablet and marks the page', () => {
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true })
    const { result, unmount } = renderSidebar()
    expect(result.current.sidebarVisible).toBe(false)
    expect(document.documentElement.hasAttribute(TABLET_LAYOUT_ATTRIBUTE)).toBe(true)

    act(() => { result.current.followViewMode('all') })
    expect(result.current.sidebarVisible).toBe(true)

    let handled = false
    act(() => { handled = result.current.collapse() })
    expect(handled).toBe(true)
    expect(result.current.sidebarVisible).toBe(false)

    unmount()
    expect(document.documentElement.hasAttribute(TABLET_LAYOUT_ATTRIBUTE)).toBe(false)
  })

  it('opens only when the view mode shows the sidebar', () => {
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true })
    const { result } = renderSidebar(true, false)
    act(() => { result.current.followViewMode('all') })
    expect(result.current.sidebarVisible).toBe(false)
  })

  it('leaves the view mode in charge off the tablet', () => {
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true })
    const { result } = renderSidebar(false)
    expect(result.current.sidebarVisible).toBe(true)
    expect(result.current.collapse()).toBe(false)
    expect(document.documentElement.hasAttribute(TABLET_LAYOUT_ATTRIBUTE)).toBe(false)
  })

  it('closes the portrait sidebar on a tap beside it, not inside it or in a menu', () => {
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true, [PORTRAIT]: true })
    const byId = renderShell()
    const { result } = renderSidebar()
    act(() => { result.current.followViewMode('all') })

    tapOn(byId('type'))
    tapOn(byId('menu'))
    expect(result.current.sidebarVisible).toBe(true)

    tapOn(byId('list'))
    expect(result.current.sidebarVisible).toBe(false)
  })

  it('keeps the landscape sidebar open on a tap beside it', () => {
    stubMediaQueries({ [TABLET_LAYOUT_QUERY]: true, [PORTRAIT]: false })
    const byId = renderShell()
    const { result } = renderSidebar()
    act(() => { result.current.followViewMode('all') })

    tapOn(byId('list'))
    act(() => { document.dispatchEvent(new Event('pointerdown')) })
    expect(result.current.sidebarVisible).toBe(true)
  })
})
