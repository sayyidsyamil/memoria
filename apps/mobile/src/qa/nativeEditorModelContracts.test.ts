import { describe, expect, it } from 'vitest'
import { nativeWysiwygDocumentWithoutExternalLink } from '../components/workspace/MobileWysiwygExternalLinkBridgeModel'
import {
  nativeWysiwygFormatCommandEffectMarkdown,
  nativeWysiwygFormatCommandLogPrefix,
  parseNativeWysiwygFormatCommandProofs,
} from './nativeWysiwygFormatCommandProbe'

const text = { type: 'text', text: 'sample' }
const paragraph = { type: 'paragraph', content: [text] }
const listItem = { type: 'listItem', content: [paragraph] }
const link = { type: 'link', attrs: { href: 'https://example.com' } }
const bold = { type: 'bold' }

describe('native unlink document preservation', () => {
  it('keeps adjacent links, atomic-node positions and other selected-text marks', () => {
    const first = { type: 'paragraph', content: [{ type: 'text', text: 'keep', marks: [link] }] }
    const rule = { type: 'horizontalRule' }
    const target = { type: 'text', text: 'target', marks: [link, bold] }
    const json = { type: 'doc', content: [first, rule, { type: 'paragraph', content: [target] }] }
    expect(nativeWysiwygDocumentWithoutExternalLink({ json, selection: { from: 8, to: 14 } })).toEqual({
      type: 'doc',
      content: [first, rule, { type: 'paragraph', content: [{ ...target, marks: [bold] }] }],
    })
    expect(target.marks).toEqual([link, bold])
    expect(json.content[0]).toBe(first)
  })

  it('leaves linked text outside the selected range unchanged', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ ...text, marks: [link] }] }] }
    expect(nativeWysiwygDocumentWithoutExternalLink({ json, selection: { from: 7, to: 9 } })).toBeNull()
    expect(json.content[0].content[0].marks).toEqual([link])
  })

  it.each([null, 3, '', { type: 'doc' }, { type: 'paragraph', content: [] }])(
    'reports no change for an empty or non-document input: %j', (json) => {
      expect(nativeWysiwygDocumentWithoutExternalLink({ json })).toBeNull()
    },
  )
})

describe('native formatting proof document contract', () => {
  it.each([
    { name: 'paragraph', json: paragraph, markdown: 'sample' },
    { name: 'heading', json: { type: 'heading', attrs: { level: 2 }, content: [text] }, markdown: '## sample' },
    { name: 'invalid heading level', json: { type: 'heading', attrs: { level: 9 }, content: [text] }, markdown: '# sample' },
    { name: 'quote', json: { type: 'blockquote', content: [paragraph] }, markdown: '> sample' },
    { name: 'bullet list', json: { type: 'bulletList', content: [listItem] }, markdown: '- sample' },
    { name: 'ordered list', json: { type: 'orderedList', content: [listItem] }, markdown: '1. sample' },
    { name: 'checked task', json: { type: 'taskList', content: [{ ...listItem, attrs: { checked: true } }] }, markdown: '- [x] sample' },
    { name: 'unchecked task', json: { type: 'taskList', content: [listItem] }, markdown: '- [ ] sample' },
    { name: 'document spacing', json: { type: 'doc', content: [paragraph, paragraph] }, markdown: 'sample\n\nsample' },
    { name: 'unknown container', json: { type: 'custom', content: [text] }, markdown: 'sample' },
    { name: 'empty document', json: { type: 'doc' }, markdown: '' },
    { name: 'non-document', json: null, markdown: '' },
  ])('renders $name independently of the production serializer', ({ json, markdown }) => {
    expect(nativeWysiwygFormatCommandEffectMarkdown(json)).toBe(markdown)
  })

  it('preserves nested formatting marks in the proof renderer', () => {
    expect(nativeWysiwygFormatCommandEffectMarkdown({ ...text, marks: [bold, { type: 'italic' }] })).toBe('***sample***')
  })

  it('filters invalid optional evidence without dropping valid false flags', () => {
    const proof = { action: 'bold', args: [1, null, 'value', true], effectApplied: false, effectMarkdown: 4, forwarded: true, method: 'toggleBold' }
    expect(parseNativeWysiwygFormatCommandProofs(`${nativeWysiwygFormatCommandLogPrefix} ${JSON.stringify(proof)}`)).toEqual([
      { action: 'bold', args: [1, 'value'], effectApplied: false, forwarded: true, method: 'toggleBold' },
    ])
  })

  it.each([
    { action: 'unsupported', args: [], forwarded: true, method: 'toggleBold' },
    { action: 'bold', args: null, forwarded: true, method: 'toggleBold' },
    { action: 'bold', args: [], forwarded: null, method: 'toggleBold' },
    { action: 'bold', args: [], forwarded: true, method: null },
  ])('rejects invalid required proof fields: %j', (proof) => {
    expect(parseNativeWysiwygFormatCommandProofs(`${nativeWysiwygFormatCommandLogPrefix} ${JSON.stringify(proof)}`)).toEqual([])
  })
})
