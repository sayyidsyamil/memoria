import {
  BlockNoteSchema,
  createBlockSpec,
  createCodeBlockSpec,
  createInlineContentSpec,
  createStyleSpec,
  defaultInlineContentSpecs,
} from '@blocknote/core'
import { CALLOUT_BLOCK_TYPE } from '../../../src/utils/calloutMarkdown'
import { HTML_BLOCK_TYPE } from '../../../src/utils/htmlBlockMarkdown'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../../../src/utils/markdownHighlightMarkdown'
import { MATH_BLOCK_TYPE, MATH_INLINE_TYPE } from '../../../src/utils/mathMarkdown'
import { MERMAID_BLOCK_TYPE } from '../../../src/utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../../../src/utils/tldrawMarkdown'

/**
 * The Memoria BlockNote schema without its React renderers: the same block, inline and style
 * names, props and content models as `src/components/editorSchema.tsx`, which is what decides
 * the shape of a `memoria.blocknote/1` document. Rendering never happens here.
 */

function placeholder(): { dom: HTMLElement } {
  return { dom: document.createElement('div') }
}

function inlinePlaceholder(): { dom: HTMLElement } {
  return { dom: document.createElement('span') }
}

function highlightElement(): { dom: HTMLElement; contentDOM: HTMLElement } {
  const mark = document.createElement('mark')
  return { dom: mark, contentDOM: mark }
}

const wikilink = createInlineContentSpec(
  { type: 'wikilink' as const, propSchema: { target: { default: '' } }, content: 'none' },
  { render: inlinePlaceholder },
)

const mathInline = createInlineContentSpec(
  { type: MATH_INLINE_TYPE, propSchema: { latex: { default: '' } }, content: 'none' },
  { render: inlinePlaceholder },
)

const highlight = createStyleSpec(
  { type: MARKDOWN_HIGHLIGHT_STYLE, propSchema: 'boolean' },
  { render: highlightElement, parse: (element) => (element.tagName === 'MARK' ? true : undefined) },
)

const calloutBlock = createBlockSpec(
  {
    type: CALLOUT_BLOCK_TYPE,
    propSchema: { calloutType: { default: 'note' }, title: { default: '' } },
    content: 'inline',
  },
  { render: () => ({ ...placeholder(), contentDOM: document.createElement('div') }) },
)

const mathBlock = createBlockSpec(
  { type: MATH_BLOCK_TYPE, propSchema: { latex: { default: '' } }, content: 'none' },
  { render: placeholder },
)

const mermaidBlock = createBlockSpec(
  { type: MERMAID_BLOCK_TYPE, propSchema: { source: { default: '' }, diagram: { default: '' } }, content: 'none' },
  { render: placeholder, runsBefore: ['codeBlock'] },
)

const tldrawBlock = createBlockSpec(
  {
    type: TLDRAW_BLOCK_TYPE,
    propSchema: {
      boardId: { default: '' },
      height: { default: TLDRAW_DEFAULT_HEIGHT },
      snapshot: { default: '{}' },
      width: { default: '' },
    },
    content: 'none',
  },
  { render: placeholder, runsBefore: ['codeBlock'] },
)

const htmlBlock = createBlockSpec(
  {
    type: HTML_BLOCK_TYPE,
    propSchema: { height: { default: '320' }, html: { default: '' }, scripts: { default: 'blocked' } },
    content: 'none',
  },
  { render: placeholder, runsBefore: ['codeBlock'] },
)

export const headlessSchema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikilink, mathInline },
}).extend({
  styleSpecs: { [MARKDOWN_HIGHLIGHT_STYLE]: highlight },
  blockSpecs: {
    calloutBlock: calloutBlock(),
    htmlBlock: htmlBlock(),
    mathBlock: mathBlock(),
    mermaidBlock: mermaidBlock(),
    tldrawBlock: tldrawBlock(),
    codeBlock: createCodeBlockSpec({}),
  },
})
