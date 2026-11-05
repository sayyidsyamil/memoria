// @vitest-environment jsdom
import { act, createElement, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PhoneScreenLayer } from './PhoneScreenLayer'

vi.mock('react-native', () => ({
  View: (props: { children: ReactNode; style: CSSProperties | CSSProperties[]; pointerEvents: string; accessibilityElementsHidden: boolean }) =>
    createElement('div', { style: Object.assign({}, ...[props.style].flat()), 'data-pointer-events': props.pointerEvents,
      'aria-hidden': props.accessibilityElementsHidden }, props.children),
  StyleSheet: { create: (styles: object) => styles, absoluteFillObject: { position: 'absolute', inset: 0 } },
}))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const mounted = vi.fn(), unmounted = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })

function Editor() {
  const [mode, setMode] = useState('rich')
  useEffect(() => { mounted(); return () => { unmounted() } }, [])
  return createElement('button', { type: 'button', onClick: () => setMode('source') }, mode)
}
function render(active: boolean) {
  return act(async () => root.render(createElement(PhoneScreenLayer, {
    active, retain: true, frame: { left: 304, width: 390 }, children: createElement(Editor),
  })))
}

it('does not eagerly create an editor that has never been visited', async () => {
  await render(false)
  expect(mounted).not.toHaveBeenCalled()
  await render(true)
  expect(mounted).toHaveBeenCalledOnce()
})

it('keeps one real editor and its selected mode when leaving and returning', async () => {
  await render(true)
  await act(async () => host.querySelector('button')?.click())
  const editor = host.querySelector('button')
  await render(false)
  expect(host.querySelector('button')).toBe(editor)
  expect(editor?.textContent).toBe('source')
  expect(host.querySelector('[aria-hidden="true"]')?.getAttribute('data-pointer-events')).toBe('none')
  expect((host.firstElementChild as HTMLElement).style.opacity).not.toBe('0')
  await render(true)
  expect(host.querySelector('button')).toBe(editor)
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
})

it('lays out the retained pane at its fixed rail position instead of resizing a preview', async () => {
  await render(true)
  const layer = host.firstElementChild as HTMLElement
  expect(layer.style.position).toBe('absolute')
  expect(layer.style.left).toBe('304px')
  expect(layer.style.width).toBe('390px')
})

it('prepares lightweight incoming panes without making their controls interactive', async () => {
  await act(async () => root.render(createElement(PhoneScreenLayer, {
    active: false, eager: true, frame: { left: 304, width: 390 }, children: createElement(Editor),
  })))
  expect(mounted).toHaveBeenCalledOnce()
  expect(host.querySelector('[aria-hidden="true"]')?.getAttribute('data-pointer-events')).toBe('none')
})
