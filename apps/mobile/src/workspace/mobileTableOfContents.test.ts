import { describe, expect, it } from 'vitest'
import {
  buildMobileTableOfContents,
  mobileTableOfContentsHeadingTargetId,
  mobileTableOfContentsTargetIdsForBlocks,
  mobileTableOfContentsTitleTargetId,
} from './mobileTableOfContents'
import type { MobileNote } from './mobileWorkspaceModel'

describe('mobile table of contents', () => {
  it('matches desktop behavior by nesting h2/h3 headings and skipping the duplicate title h1', () => {
    const toc = buildMobileTableOfContents({
      blocks: [],
      bullets: [],
      note: note({
        rawContent: [
          '---',
          'type: Essay',
          '---',
          '# Workflow Orchestration Essay',
          '',
          '## Mobile parity notes',
          '',
          '### Relationships',
          '',
          '# Appendix',
        ].join('\n'),
      }),
      untitledLabel: 'Untitled heading',
    })

    expect(toc).toMatchObject({
      children: [
        {
          children: [
            {
              children: [],
              level: 3,
              title: 'Relationships',
            },
          ],
          level: 2,
          title: 'Mobile parity notes',
        },
        {
          children: [],
          level: 1,
          title: 'Appendix',
        },
      ],
      level: 1,
      title: 'Workflow Orchestration Essay',
    })
    expect(toc.id).toBe(mobileTableOfContentsTitleTargetId)
    expect(toc.children.map((item) => item.id)).toEqual([
      mobileTableOfContentsHeadingTargetId(0),
      mobileTableOfContentsHeadingTargetId(2),
    ])
    expect(toc.children[0]?.children[0]?.id).toBe(mobileTableOfContentsHeadingTargetId(1))
  })

  it('uses editable mobile editor blocks when raw markdown is unavailable', () => {
    const toc = buildMobileTableOfContents({
      blocks: [
        { kind: 'heading', level: 2, text: 'Source-backed section' },
        { kind: 'heading', level: 4, text: 'Ignored deep heading' },
      ],
      bullets: [],
      note: note({ rawContent: undefined }),
      untitledLabel: 'Untitled heading',
    })

    expect(toc.children.map((item) => item.title)).toEqual(['Source-backed section'])
  })

  it('aligns rendered heading target IDs with duplicate-title TOC entries', () => {
    expect(mobileTableOfContentsTargetIdsForBlocks({
      blocks: [
        { kind: 'heading', level: 1, text: 'Workflow Orchestration Essay' },
        { kind: 'paragraph', content: [{ text: 'Intro' }] },
        { kind: 'heading', level: 2, text: 'Mobile parity notes' },
        { kind: 'heading', level: 3, text: 'Relationships' },
      ],
      title: 'Workflow Orchestration Essay',
    })).toEqual([
      undefined,
      undefined,
      mobileTableOfContentsHeadingTargetId(0),
      mobileTableOfContentsHeadingTargetId(1),
    ])
  })
})

function note(overrides: Partial<MobileNote>): MobileNote {
  return {
    archived: false,
    created: '5d ago',
    date: '5d ago',
    favorite: false,
    id: 'workflow-orchestration',
    links: 0,
    modified: '1h ago',
    rawContent: '',
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: 'Workflow Orchestration Essay',
    type: 'Essay',
    typeTone: 'green',
    workspace: 'TV',
    ...overrides,
  }
}
