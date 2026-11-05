import { describe, expect, it } from 'vitest'
import { mobileMarkdownBodyToTentapHtml } from './mobileDocumentContent'

describe('mobile document mixed nested lists', () => {
  it('hydrates bullet lists with nested task-list children', () => {
    const html = mobileMarkdownBodyToTentapHtml('- Product agency\n  - [ ] Education products\n- Newsletter\n')

    expect(html).toBe(
      '<ul><li><p>Product agency</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Education products</p></div></li></ul></li><li><p>Newsletter</p></li></ul>',
    )
  })

  it('hydrates ordered lists with nested bullet-list children', () => {
    const html = mobileMarkdownBodyToTentapHtml('1. Business model\n  - Sponsorships\n  - Subscriptions\n2. Interviewing\n')

    expect(html).toBe(
      '<ol><li><p>Business model</p><ul><li><p>Sponsorships</p></li><li><p>Subscriptions</p></li></ul></li><li><p>Interviewing</p></li></ol>',
    )
  })

  it('hydrates bullet lists with nested ordered-list children', () => {
    const html = mobileMarkdownBodyToTentapHtml('- Process:\n  1. Contextualize\n  2. Summarize\n')

    expect(html).toBe(
      '<ul><li><p>Process:</p><ol><li><p>Contextualize</p></li><li><p>Summarize</p></li></ol></li></ul>',
    )
  })
})
