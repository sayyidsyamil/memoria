import { describe, expect, it } from 'vitest'
import { mobileDiagramFenceHtml, mobileMarkdownHasDiagrams, readMobileDiagramSource } from './mobileDiagramMarkdown'
import { mobileMarkdownBodyToTentapHtml, tiptapJsonToMobileMarkdown } from './mobileDocumentContent'

describe('mobile diagram source preservation', () => {
  it('retains the exact fence and attributes while extracting Mermaid content', () => {
    const source = '~~~~Mermaid id="flow"\nflowchart LR\n A --> B\n~~~~'
    expect(readMobileDiagramSource(source)).toEqual({ kind: 'mermaid', source, content: 'flowchart LR\n A --> B' })
  })

  it('recognizes desktop whiteboard snapshots without rewriting their JSON', () => {
    const source = '```tldraw id="board" height="520" custom="kept"\n{ "store": {} }\n```'
    expect(readMobileDiagramSource(source)).toEqual({ kind: 'tldraw', source, content: '{ "store": {} }' })
  })

  it('keeps unsupported and unfinished fences in the ordinary source fallback', () => {
    for (const source of ['```js\ncode\n```', '```mermaid\nA --> B', '```mermaid\nA\n~~~']) {
      expect(readMobileDiagramSource(source)).toBeNull()
      expect(mobileDiagramFenceHtml(source)).toBeNull()
    }
  })

  it('encodes diagram source as inert HTML data', () => {
    const source = '```mermaid\ngraph LR\n A["<img src=x onerror=alert(1)>"]\n```'
    const html = mobileDiagramFenceHtml(source)
    expect(html).toContain('data-mobile-diagram-kind="mermaid"')
    expect(html).not.toContain('<img')
    expect(html).toContain(encodeURIComponent(source))
  })

  it('does not load the renderer for ordinary notes or fenced examples', () => {
    expect(mobileMarkdownHasDiagrams('# Ordinary note\n\nBody')).toBe(false)
    expect(mobileMarkdownHasDiagrams('````text\n```mermaid\ngraph LR\n A --> B\n```\n````')).toBe(false)
    expect(mobileMarkdownHasDiagrams('# Diagram\n\n```mermaid\ngraph LR\n A --> B\n```')).toBe(true)
  })

  it('hydrates diagrams as source-preserving blocks and serializes them unchanged', () => {
    const source = '```tldraw id="board" height="520"\n{ "store": {} }\n```'
    expect(mobileMarkdownBodyToTentapHtml(source, { diagrams: true })).toContain('data-mobile-diagram-kind="tldraw"')
    expect(tiptapJsonToMobileMarkdown({ type: 'doc', content: [
      { type: 'mobileDiagram', attrs: { source } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Following text' }] },
    ] })).toBe(`${source}\n\nFollowing text`)
  })
})
