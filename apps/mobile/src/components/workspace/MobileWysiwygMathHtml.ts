import katex from 'katex'

type LatexSource = string
type HtmlSnippet = string
const safeMathOptions = { output: 'mathml', throwOnError: false, trust: false } as const

export function mobileInlineMathSource(latex: LatexSource): string {
  return `$${latex}$`
}

export function mobileDisplayMathSource(latex: LatexSource): string {
  return `$$\n${latex.trimEnd()}\n$$`
}

export function renderMobileInlineMathHtml(latex: LatexSource): HtmlSnippet {
  return renderMobileMathHtml(latex, false)
}

export function renderMobileDisplayMathHtml(latex: LatexSource): HtmlSnippet {
  return renderMobileMathHtml(latex, true)
}

export function renderMobileMathIntoElement(latex: LatexSource, element: HTMLElement, displayMode: boolean): void {
  try {
    katex.render(latex, element, { ...safeMathOptions, displayMode })
  } catch {
    element.textContent = latex
  }
}

function renderMobileMathHtml(latex: LatexSource, displayMode: boolean): HtmlSnippet {
  try {
    return katex.renderToString(latex, { ...safeMathOptions, displayMode })
  } catch {
    return escapeHtml(latex)
  }
}

function escapeHtml(text: string): HtmlSnippet {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
