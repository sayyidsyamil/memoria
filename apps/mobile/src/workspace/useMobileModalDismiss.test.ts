// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMobileModalDismiss } from './useMobileModalDismiss'

const native = vi.hoisted(() => ({ setModalOpen: vi.fn(async () => {}) }))
const platform = vi.hoisted(() => ({ OS: 'ios' }))
const back = vi.hoisted(() => ({
  listen: vi.fn<(name: string, listener: () => boolean) => { remove: () => void }>(),
  remove: vi.fn(),
}))
const shortcut = vi.hoisted(() => ({
  listen: vi.fn<(listener: (event: { key: string }) => void) => (() => void) | undefined>(),
  unsubscribe: vi.fn(),
}))
vi.mock('../native/mobileNativeKeyCommands', () => ({ optionalNativeMobileKeyCommandsModule: () => native }))
vi.mock('react-native', () => ({ Platform: platform, BackHandler: { addEventListener: back.listen } }))
vi.mock('./mobileWorkspaceKeyboardShortcuts', () => ({
  installMobileWorkspaceKeyboardShortcuts: shortcut.listen,
}))

const cleanups: (() => Promise<void>)[] = []
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  platform.OS = 'ios'
})

it('registers only a visible modal and uses the latest cancel callback without changing its position', async () => {
  const probe = harness()
  const previous = vi.fn()
  const current = vi.fn()
  await probe.render(previous, false)
  expect(shortcut.listen).not.toHaveBeenCalled()
  await probe.render(previous, true)
  await probe.render(current, true)
  expect(shortcut.listen).toHaveBeenCalledOnce()
  await probe.escape()
  expect(previous).not.toHaveBeenCalled()
  expect(current).toHaveBeenCalledOnce()
  expect(native.setModalOpen.mock.calls).toEqual([[true]])
  await probe.render(current, false)
  expect(native.setModalOpen.mock.calls).toEqual([[true], [false]])
  expect(shortcut.unsubscribe).toHaveBeenCalledOnce()
  expect(back.listen).not.toHaveBeenCalled()
})

it('keeps the native Escape command enabled until the last open modal unmounts', async () => {
  const parent = harness()
  const child = harness()
  const closeParent = vi.fn()
  const closeChild = vi.fn()
  await parent.render(closeParent, true)
  await child.render(closeChild, true)
  await parent.render(closeParent, true)
  await parent.escape()
  expect(closeChild).toHaveBeenCalledOnce()
  expect(closeParent).not.toHaveBeenCalled()
  await child.unmount()
  expect(native.setModalOpen.mock.calls).toEqual([[true]])
  await parent.escape()
  expect(closeParent).toHaveBeenCalledOnce()
  await parent.unmount()
  expect(native.setModalOpen.mock.calls).toEqual([[true], [false]])
  expect(shortcut.unsubscribe).toHaveBeenCalledOnce()
})

it('dismisses only the topmost Android overlay and removes Back handling after the last closes', async () => {
  platform.OS = 'android'
  back.listen.mockImplementation(() => ({ remove: back.remove }))
  const parent = harness()
  const child = harness()
  const closeParent = vi.fn()
  const previous = vi.fn()
  const current = vi.fn()
  await parent.render(closeParent, true)
  await child.render(previous, true)
  await child.render(current, true)
  expect(back.listen).toHaveBeenCalledOnce()
  expect(back.listen.mock.calls[0]?.[0]).toBe('hardwareBackPress')
  const pressBack = back.listen.mock.calls[0]?.[1]
  await act(async () => { expect(pressBack?.()).toBe(true) })
  expect(current).toHaveBeenCalledOnce()
  expect(previous).not.toHaveBeenCalled()
  expect(closeParent).not.toHaveBeenCalled()
  await child.unmount()
  expect(back.remove).not.toHaveBeenCalled()
  await act(async () => { expect(pressBack?.()).toBe(true) })
  expect(closeParent).toHaveBeenCalledOnce()
  await parent.unmount()
  expect(back.remove).toHaveBeenCalledOnce()
  expect(pressBack?.()).toBe(false)
  expect(shortcut.unsubscribe).toHaveBeenCalledOnce()
})

it('does not intercept Android Back for a hidden overlay', async () => {
  platform.OS = 'android'
  await harness().render(vi.fn(), false)
  expect(back.listen).not.toHaveBeenCalled()
})

it('cleans up Android Back when no native or browser keyboard bridge is available', async () => {
  platform.OS = 'android'
  back.listen.mockImplementation(() => ({ remove: back.remove }))
  const probe = harness()
  shortcut.listen.mockReturnValue(undefined)
  const close = vi.fn()
  await probe.render(close, true)
  await act(async () => { expect(back.listen.mock.calls[0]?.[1]()).toBe(true) })
  expect(close).toHaveBeenCalledOnce()
  await probe.unmount()
  expect(back.remove).toHaveBeenCalledOnce()
})

function harness() {
  shortcut.listen.mockImplementation(() => shortcut.unsubscribe)
  const root = createRoot(document.createElement('div'))
  let mounted = true
  function Probe({ close, active }: { close: () => void; active: boolean }) {
    useMobileModalDismiss(close, active)
    return null
  }
  const unmount = async () => {
    if (mounted) { mounted = false; await act(async () => root.unmount()) }
  }
  cleanups.push(unmount)
  return {
    unmount,
    render: (close: () => void, active: boolean) => act(async () => root.render(createElement(Probe, { close, active }))),
    escape: () => act(async () => shortcut.listen.mock.calls.at(-1)?.[0]({ key: 'Escape' })),
  }
}
