import type { MobileEditorBlock as FixtureEditorBlock } from '../workspace/mobileWorkspaceModel'

export const fixtureEditorBullets = [
  'The current narrative routes every workflow through an LLM surface.',
  'Memoria should keep writing, relationships, and properties visible together.',
  'The mobile UI should match desktop semantics before phone-specific reduction.',
]

export const fixtureEditorBlocks: FixtureEditorBlock[] = [
  {
    kind: 'paragraph',
    content: [
      { text: 'Memoria should keep ' },
      { bold: true, text: 'writing, relationships, and properties' },
      { text: ' visible together before we reduce the interface for smaller screens.' },
    ],
  },
  {
    kind: 'heading',
    level: 2,
    text: 'Mobile parity notes',
  },
  {
    kind: 'bullets',
    items: [
      {
        content: [{ text: 'Start from desktop semantics, then adapt only for touch and navigation.' }],
      },
      {
        content: [
          { text: 'Use ' },
          { code: true, text: 'muted' },
          { text: ' text for previews, section labels, dates, and lower-priority chrome.' },
        ],
      },
      {
        content: [{ italic: true, text: 'Relationship values stay typed, colored, and full-width.' }],
      },
    ],
  },
  {
    kind: 'quote',
    content: [
      { text: 'Desktop parity is the baseline; mobile convention is an explicit exception.' },
    ],
  },
  {
    headers: ['Surface', 'Desktop source', 'Mobile target'],
    kind: 'table',
    rows: [
      ['Sidebar', 'SidebarGroupHeader', 'muted 10px groups'],
      ['Note list', 'NoteItem', '13px titles, 12px previews'],
      ['Inspector', 'RelationshipsPanel', 'full-width typed relationships'],
    ],
  },
]

export const longTitleEditorBlocks: FixtureEditorBlock[] = [
  {
    kind: 'paragraph',
    content: [
      { text: 'This note intentionally uses a title long enough to pressure the row, toolbar, and editor heading.' },
    ],
  },
  {
    kind: 'bullets',
    items: [
      { content: [{ text: 'Truncate in narrow chrome.' }] },
      { content: [{ text: 'Wrap only inside the editor content area.' }] },
    ],
  },
]

export const propertyHeavyEditorBlocks: FixtureEditorBlock[] = [
  {
    kind: 'paragraph',
    content: [
      { text: 'Property-heavy notes should preserve scanability even when relationships contain several typed groups.' },
    ],
  },
  {
    kind: 'heading',
    level: 3,
    text: 'Inspector pressure',
  },
  {
    kind: 'table',
    headers: ['Property', 'Expected rendering'],
    rows: [
      ['Tags', 'wrap under the label'],
      ['Belongs to', 'typed full-width rows'],
      ['Has', 'multiple values without a global heading'],
    ],
  },
]

export const markdownHeavyEditorBlocks: FixtureEditorBlock[] = [
  {
    kind: 'paragraph',
    content: [
      { text: 'This fixture exercises ' },
      { bold: true, text: 'desktop markdown parity' },
      { text: ' across native React Native rendering.' },
    ],
  },
  {
    kind: 'heading',
    level: 4,
    text: 'Detailed renderer coverage',
  },
  {
    kind: 'orderedList',
    items: [
      {
        content: [
          { text: 'Render a regular ' },
          { linkHref: 'https://example.com', text: 'link' },
          { text: ' and preserve spacing.' },
        ],
        marker: '1.',
      },
      {
        content: [{ text: 'Show nested ordered list indentation.' }],
        depth: 1,
        marker: '1.',
      },
    ],
  },
  {
    kind: 'tasks',
    items: [
      {
        checked: true,
        content: [{ text: 'Completed native renderer pass with ' }, { strike: true, text: 'stale copy' }],
      },
      {
        checked: false,
        content: [{ text: 'Verify simulator spacing after web QA.' }],
      },
    ],
  },
  {
    code: 'const renderer = "native";',
    kind: 'codeBlock',
    language: 'typescript',
  },
  {
    kind: 'divider',
  },
  {
    kind: 'paragraph',
    content: [
      { text: 'Navigate back to ' },
      { text: 'Workflow Orchestration Essay', wikilinkTarget: 'workflow-orchestration' },
      { text: ' from a wikilink.' },
    ],
  },
]
