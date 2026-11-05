import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  keepCaretAboveKeyboard,
  useKeyboardAwareViewport,
  VISUAL_VIEWPORT_HEIGHT_VAR,
  VISUAL_VIEWPORT_TOP_VAR,
} from './useKeyboardAwareViewport'

function stubVisualViewport(height: number, offsetTop = 0) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop })
  vi.stubGlobal('visualViewport', viewport)
  return viewport
}

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }
}

/** A scrolling editor with the caret in its one paragraph, at the given box. */
function editorWithCaret(caretBox: DOMRect, rangeBox = caretBox) {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  Object.defineProperty(scroller, 'scrollHeight', { value: 2000 })
  Object.defineProperty(scroller, 'clientHeight', { value: 400 })
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  const paragraph = document.createElement('p')
  paragraph.textContent = 'Line of a long note.'
  paragraph.getBoundingClientRect = () => caretBox
  editable.append(paragraph)
  scroller.append(editable)
  document.body.append(scroller)
  editable.focus()
  const range = document.createRange()
  range.setStart(paragraph.firstChild as Text, 4)
  range.collapse(true)
  range.getBoundingClientRect = () => rangeBox
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  return scroller
}

describe('keepCaretAboveKeyboard', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('scrolls the editor until the caret clears the keyboard', () => {
    const scroller = editorWithCaret(rect(380, 400))
    keepCaretAboveKeyboard(300)
    expect(scroller.scrollTop).toBe(124)
  })

  it('measures a collapsed caret by its paragraph', () => {
    const scroller = editorWithCaret(rect(380, 400), rect(0, 0))
    keepCaretAboveKeyboard(300)
    expect(scroller.scrollTop).toBe(124)
  })

  it('leaves a caret that is already visible alone', () => {
    const scroller = editorWithCaret(rect(100, 120))
    keepCaretAboveKeyboard(300)
    expect(scroller.scrollTop).toBe(0)
  })

  it('leaves an editor that cannot scroll alone', () => {
    const scroller = editorWithCaret(rect(380, 400))
    scroller.style.overflowY = 'visible'
    expect(() => { keepCaretAboveKeyboard(300) }).not.toThrow()
    expect(scroller.scrollTop).toBe(0)
  })

  it('does nothing when no editor has focus', () => {
    const scroller = editorWithCaret(rect(380, 400))
    ;(document.activeElement as HTMLElement).blur()
    keepCaretAboveKeyboard(300)
    expect(scroller.scrollTop).toBe(0)
  })
})

describe('useKeyboardAwareViewport', () => {
  const root = document.documentElement.style

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('follows the visual viewport while active and clears it afterwards', () => {
    const viewport = stubVisualViewport(659)
    const { unmount } = renderHook(() => useKeyboardAwareViewport(true))
    expect(root.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe('659px')

    Object.assign(viewport, { height: 359, offsetTop: 12 })
    viewport.dispatchEvent(new Event('resize'))
    expect(root.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe('359px')
    expect(root.getPropertyValue(VISUAL_VIEWPORT_TOP_VAR)).toBe('12px')

    unmount()
    expect(root.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe('')
  })

  it('leaves the page alone when inactive', () => {
    stubVisualViewport(659)
    renderHook(() => useKeyboardAwareViewport(false))
    expect(root.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe('')
  })
})
