import { describe, expect, it } from 'vitest'
import {
  mobileDisplayMathSource,
  mobileInlineMathSource,
  renderMobileDisplayMathHtml,
  renderMobileInlineMathHtml,
} from './MobileWysiwygMathHtml'

describe('mobile WYSIWYG math HTML', () => {
  it('renders inline math as MathML for native WebView display', () => {
    const html = renderMobileInlineMathHtml('x^2')

    expect(html).toContain('<math')
    expect(html).toContain('<msup>')
    expect(html).toContain('<annotation encoding="application/x-tex">x^2</annotation>')
  })

  it('keeps the desktop markdown source available for editor metadata', () => {
    expect(mobileInlineMathSource('\\sqrt{x}')).toBe('$\\sqrt{x}$')
  })

  it('renders display math as MathML for native WebView display', () => {
    const html = renderMobileDisplayMathHtml(String.raw`\sqrt{a^2 + b^2}`)

    expect(html).toContain('<math')
    expect(html).toContain('<msqrt>')
    expect(html).toContain('display="block"')
  })

  it('keeps desktop display math source available for editor metadata', () => {
    expect(mobileDisplayMathSource('\\sqrt{x}\n')).toBe('$$\n\\sqrt{x}\n$$')
  })

  it('escapes raw HTML-like source inside rendered math output', () => {
    const html = renderMobileInlineMathHtml(String.raw`\text{<tag>}`)

    expect(html).toContain('&lt;tag&gt;')
    expect(html).not.toContain('<tag>')
  })
})
