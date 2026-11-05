// @vitest-environment jsdom
import katex from 'katex'
import { afterEach, expect, it, vi } from 'vitest'
import { renderMobileMathIntoElement } from './MobileWysiwygMathHtml'

afterEach(() => { vi.restoreAllMocks() })

it.each([false, true])('renders MathML directly into a DOM node, display mode %s', (displayMode) => {
  const element = document.createElement('div')
  renderMobileMathIntoElement('x^2', element, displayMode)
  expect(element.querySelector('math')).not.toBeNull()
  expect(element.querySelector('annotation')?.textContent).toBe('x^2')
  expect(element.querySelector('math')?.getAttribute('display')).toBe(displayMode ? 'block' : null)
})

it.each([
  String.raw`\text{<img src=x onerror=alert(1)>}`,
  String.raw`\href{javascript:alert(1)}{unsafe}`,
  String.raw`\htmlClass{unsafe}{<script>alert(1)</script>}`,
])('does not grant HTML or scripting authority to math %s', (latex) => {
  const element = document.createElement('span')
  renderMobileMathIntoElement(latex, element, false)
  expect(element.querySelector('script, img, iframe, svg, a')).toBeNull()
})

it('retains literal source when DOM rendering fails', () => {
  vi.spyOn(katex, 'render').mockImplementation(() => { throw new Error('controlled render failure') })
  const element = document.createElement('span')
  const latex = '<img src=x onerror=alert(1)>'
  renderMobileMathIntoElement(latex, element, false)
  expect(element.textContent).toBe(latex)
  expect(element.children).toHaveLength(0)
})
