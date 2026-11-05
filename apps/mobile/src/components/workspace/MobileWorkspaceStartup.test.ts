// @vitest-environment jsdom
import { act, createElement, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileWorkspaceStartup } from './MobileWorkspaceStartup'
import type { WorkspaceSnapshotPreview } from '../../workspace/workspaceSnapshotPreview'
import { workspaceScenarioForId } from '../../fixtures/workspaceFixtures'

const device = vi.hoisted(() => ({ tablet: false, width: 390, height: 844 }))
const panels = vi.hoisted(() => ({ sidebar: vi.fn(), list: vi.fn() }))
const capture = vi.hoisted(() => vi.fn())
vi.mock('../../analytics/useMobileAnalytics', () => ({ useMobileAnalytics: () => ({ capture }) }))
vi.mock('react-native', () => ({
  View: ({ children, testID, pointerEvents, accessibilityElementsHidden, accessibilityState }: {
    children?: ReactNode; testID?: string; pointerEvents?: string; accessibilityElementsHidden?: boolean; accessibilityState?: { busy: boolean }
  }) => createElement('div', { 'data-testid': testID, 'data-pointer': pointerEvents, 'data-hidden': accessibilityElementsHidden,
    'aria-busy': accessibilityState?.busy }, children),
  ActivityIndicator: () => createElement('span', null, 'spinner'),
  StyleSheet: { create: (styles: object) => styles, absoluteFillObject: {}, hairlineWidth: 1 },
  Dimensions: { get: () => ({ width: device.width, height: device.height }) },
  Platform: { OS: 'ios', isPad: true },
  useWindowDimensions: () => ({ width: device.width, height: device.height }),
}))
vi.mock('../../ui/useMobileDeviceLayout', () => ({ useMobileDeviceLayout: () => device.tablet ? 'tablet' : 'phone' }))
vi.mock('../../ui/theme/useMobileTheme', async () => {
  const { mobileMetrics } = await import('../../ui/mobileMetrics')
  const { mobilePalettes } = await import('../../ui/theme/mobilePalette')
  return { useMobileStyles: (factory: (colors: object, metrics: object) => object) => factory(mobilePalettes.light, mobileMetrics[1.2]) }
})
vi.mock('../../ui/MobilePanelSafeArea', () => ({ MobilePanelSafeArea: ({ children }: { children: ReactNode }) => children }))
vi.mock('../ui/text', () => ({ Text: ({ children }: { children: ReactNode }) => createElement('span', null, children) }))
vi.mock('./MobileWorkspaceSidebar', () => ({ MobileWorkspaceSidebar: panels.sidebar }))
vi.mock('./MobileNoteListPanel', () => ({ MobileNoteListPanel: panels.list }))
vi.mock('../../qa/nativeStartupPresentation', () => ({ recordNativeStartupPreviewLayout: vi.fn() }))

const preview: WorkspaceSnapshotPreview = { kind: 'provisional', notes: [], allNotes: [], typeDefinitions: {},
  sidebarSections: [], noteListSubtitle: '', source: { kind: 'localVault', label: 'Cached QA', totalNotes: 9000, visibleNotes: 128 } }
const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  device.tablet = false
  device.width = 390
  device.height = 844
  panels.sidebar.mockReset().mockReturnValue(null)
  panels.list.mockReset().mockReturnValue(null)
  capture.mockReset()
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('allows cached-list browsing without mounting an editable workspace', async () => {
  const render = createHarness()
  await render.update(preview, true, false)
  expect(render.node.textContent).not.toContain('editable child')
  expect(render.node.querySelector('[data-testid="workspace-startup-preview"]')).not.toBeNull()
  expect(render.node.querySelector('[data-testid="workspace-startup-cached-panels"]')?.getAttribute('data-pointer')).not.toBe('none')
  expect(render.node.querySelector('[data-testid="workspace-startup-cached-panels"]')?.getAttribute('data-hidden')).not.toBe('true')
  expect(panels.list).toHaveBeenCalledWith(expect.objectContaining({ fullWidth: true, compact: true, showCreateAction: false,
    notes: preview.notes }), undefined)
  expect(panels.list.mock.lastCall?.[0].toolbarTrailing).toBeUndefined()
  expect(panels.sidebar).not.toHaveBeenCalled()
  const list = panels.list.mock.lastCall?.[0]
  list.onSelectNote('chosen.md')
  expect(render.select).toHaveBeenCalledWith('chosen.md')
  expect(capture).toHaveBeenCalledWith({ name: 'mobile_startup_preview_used' })
  expect(list.bulkActions).toBeUndefined()
  expect(list.onToggleNoteFavorite).toBeUndefined()
})

it('uses the normal tablet panel components when the viewport allows its sidebar', async () => {
  device.tablet = true
  device.width = 1366
  device.height = 1024
  const render = createHarness()
  await render.update(preview, true, false)
  expect(panels.sidebar).toHaveBeenCalledWith(expect.objectContaining({ sections: preview.sidebarSections, title: 'Cached QA' }), undefined)
  expect(panels.list).toHaveBeenCalledWith(expect.objectContaining({ fullWidth: false }), undefined)
})

it('browses cached types and archived notes with the normal navigation rules and no write actions', async () => {
  device.tablet = true
  device.width = 1366
  const note = workspaceScenarioForId(null).notes[0]
  const notes = [{ ...note, id: 'open.md', type: 'Note', archived: false },
    { ...note, id: 'archived.md', type: 'Note', archived: true }]
  const cached = { ...preview, notes, allNotes: notes }
  const render = createHarness()
  await render.update(cached, true, false)
  await act(async () => panels.sidebar.mock.lastCall?.[0].onSelectItem({ id: 'type-note', label: 'Notes', typeName: 'Note', sectionId: 'types' }))
  expect(panels.list.mock.lastCall?.[0].notes.map((value: { id: string }) => value.id)).toEqual(['open.md'])
  await act(async () => panels.list.mock.lastCall?.[0].onNoteListFilterChange('archived'))
  expect(panels.list.mock.lastCall?.[0].notes.map((value: { id: string }) => value.id)).toEqual(['archived.md'])
  expect(panels.list.mock.lastCall?.[0].bulkActions).toBeUndefined()
  expect(render.node.textContent).not.toContain('editable child')
})

it('keeps the sidebar hidden in a narrow iPad window just like the real workspace', async () => {
  device.tablet = true
  device.width = 834
  const render = createHarness()
  await render.update(preview, true, false)
  expect(panels.sidebar).not.toHaveBeenCalled()
  expect(panels.list).toHaveBeenCalled()
})

it('retains the initial primary-list property display and title rather than inventing new row spacing', async () => {
  const configured = { ...preview, noteListPropertyOverrides: { inbox: ['Status'] },
    sidebarSections: [{ id: 'primary', items: [{ id: 'inbox', label: 'Inbox', icon: 'inbox' as const, active: true }] }] }
  const render = createHarness()
  await render.update(configured, true, false)
  expect(panels.list).toHaveBeenCalledWith(expect.objectContaining({ title: 'Inbox', displayPropertyKeys: ['Status'] }), undefined)
})

it.each([
  { cached: null, pending: true, active: false },
  { cached: preview, pending: true, active: true },
])('never substitutes cached presentation outside initial loading: %j', async ({ cached, pending, active }) => {
  const render = createHarness()
  await render.update(cached, pending, active)
  expect(render.node.textContent).toBe('editable child')
  expect(panels.list).not.toHaveBeenCalled()
})

it('keeps cached panels visible after a failed reload without a full-screen status or busy announcement', async () => {
  const render = createHarness('Reloading vault from disk')
  await render.update(preview, true, false)
  await render.update(preview, false, false)
  expect(render.node.querySelector('[data-testid="workspace-startup-preview"]')).not.toBeNull()
  expect(render.node.querySelector('[aria-busy="true"]')).toBeNull()
  expect(render.node.textContent).not.toContain('Reloading vault')
})

it('does not remount an existing editor when a late preview or pending-state update arrives', async () => {
  let mounts = 0
  function Editor() { useEffect(() => { mounts++ }, []); return createElement('span', null, 'draft') }
  const render = createHarness(createElement(Editor))
  await render.update(null, false, true)
  await render.update(preview, true, true)
  await render.update(null, false, true)
  expect(mounts).toBe(1)
  expect(render.node.textContent).toBe('draft')
})

function createHarness(children: ReactNode = 'editable child') {
  const node = document.createElement('div')
  const root = createRoot(node)
  roots.push(root)
  const select = vi.fn()
  return { node, select, update: (preview: WorkspaceSnapshotPreview | null, pending: boolean, hasActiveWorkspace: boolean) =>
    act(async () => root.render(createElement(MobileWorkspaceStartup, { preview, pending, hasActiveWorkspace, children, onSelectNote: select }))) }
}
