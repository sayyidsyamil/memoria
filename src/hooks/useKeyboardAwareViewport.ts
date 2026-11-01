import { useEffect } from 'react'

/** Read by the phone layout in App.css: the part of the page the keyboard leaves visible. */
export const VISUAL_VIEWPORT_HEIGHT_VAR = '--memoria-visual-viewport-height'
export const VISUAL_VIEWPORT_TOP_VAR = '--memoria-visual-viewport-top'
/** Room kept between the caret and the top of the keyboard. */
const CARET_MARGIN_PX = 24
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])'

function caretRect(selection: Selection): DOMRect | null {
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (rect.height > 0) return rect
  const node = range.startContainer
  const element = node instanceof Element ? node : node.parentElement
  return element?.getBoundingClientRect() ?? null
}

function scrollParent(node: Node): HTMLElement | null {
  let element = node instanceof HTMLElement ? node : node.parentElement
  while (element) {
    const { overflowY } = getComputedStyle(element)
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) return element
    element = element.parentElement
  }
  return null
}

function focusedCaret(): { node: Node; rect: DOMRect } | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.anchorNode) return null
  if (!document.activeElement?.closest(EDITABLE_SELECTOR)) return null
  const rect = caretRect(selection)
  return rect ? { node: selection.anchorNode, rect } : null
}

/** Scrolls the editor so the caret sits above the keyboard, not behind it. */
export function keepCaretAboveKeyboard(visibleBottom: number): void {
  const caret = focusedCaret()
  if (!caret) return
  const overlap = caret.rect.bottom + CARET_MARGIN_PX - visibleBottom
  if (overlap <= 0) return
  const container = scrollParent(caret.node)
  if (container) container.scrollTop += overlap
}

function applyVisualViewport(viewport: VisualViewport): void {
  const root = document.documentElement.style
  root.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${viewport.height}px`)
  root.setProperty(VISUAL_VIEWPORT_TOP_VAR, `${viewport.offsetTop}px`)
  // Let the shell take its new height first, then measure the caret against it.
  requestAnimationFrame(() => { keepCaretAboveKeyboard(viewport.offsetTop + viewport.height) })
}

function clearVisualViewport(): void {
  const root = document.documentElement.style
  root.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR)
  root.removeProperty(VISUAL_VIEWPORT_TOP_VAR)
}

/**
 * Phone web layout (TOL-193): the shell follows `visualViewport`, which shrinks when the
 * on-screen keyboard opens, and the caret is scrolled back above it. Written to CSS variables,
 * not React state, so typing and keyboard animations never re-render the app.
 */
export function useKeyboardAwareViewport(active: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) return
    const update = () => { applyVisualViewport(viewport) }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      clearVisualViewport()
    }
  }, [active])
}
