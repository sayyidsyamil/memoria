import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateMobileSavedView, parseMobileSavedViewFile } from './mobileSavedViews'
import { note, requiredView } from './mobileSavedViewsTestFixtures'

describe('mobile saved views', () => {
  afterEach(() => vi.useRealTimers())


  it('parses desktop saved-view YAML and evaluates filters against mobile notes', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/active-projects.yml',
      content: `name: Active Projects
icon: rocket
color: blue
sort: "modified:desc"
filters:
  all:
    - field: type
      op: equals
      value: Project
    - field: status
      op: any_of
      value: [Active, Draft]
`,
    }, 0)

    expect(view).toMatchObject({
      filename: 'active-projects.yml',
      id: 'view-active-projects',
      definition: {
        color: 'blue',
        icon: 'rocket',
        name: 'Active Projects',
        sort: 'modified:desc',
      },
    })
    expect(evaluateMobileSavedView(requiredView(view), [
      note({ id: 'draft-project', modifiedAt: 10, status: 'Draft', title: 'Draft project', type: 'Project' }),
      note({ id: 'active-project', modifiedAt: 20, status: 'Active', title: 'Active project', type: 'Project' }),
      note({ id: 'done-project', modifiedAt: 30, status: 'Done', title: 'Done project', type: 'Project' }),
      note({ id: 'active-procedure', modifiedAt: 40, status: 'Active', title: 'Active procedure', type: 'Procedure' }),
    ]).map((candidate) => candidate.id)).toEqual(['active-project', 'draft-project'])
  })

  it('loads legacy desktop saved views from the pre-migration .laputa directory', () => {
    const view = parseMobileSavedViewFile({
      relativePath: '.laputa/views/legacy-focus.yml',
      content: `name: Legacy Focus
filters:
  all:
    - field: type
      op: equals
      value: Essay
`,
    }, 0)

    expect(view).toMatchObject({
      filename: 'legacy-focus.yml',
      id: 'view-legacy-focus',
      definition: { name: 'Legacy Focus' },
    })
    expect(evaluateMobileSavedView(requiredView(view), [
      note({ id: 'essay', type: 'Essay' }),
      note({ id: 'procedure', type: 'Procedure' }),
    ]).map((candidate) => candidate.id)).toEqual(['essay'])
  })

  it('parses desktop saved-view inline YAML quoted scalars', () => {
    const commaView = parseMobileSavedViewFile({
      relativePath: 'views/tagged.yml',
      content: `name: Tagged
listPropertiesDisplay: ["AI, UX", Status]
filters:
  all:
    - field: tags
      op: any_of
      value: ["AI, UX", Design]
`,
    }, 0)

    expect(commaView?.definition.listPropertiesDisplay).toEqual(['AI, UX', 'Status'])
    expect(evaluateMobileSavedView(requiredView(commaView), [
      note({ id: 'quoted-comma', tags: ['AI, UX'] }),
      note({ id: 'plain', tags: ['Design'] }),
      note({ id: 'split-would-be-wrong', tags: ['AI'] }),
    ]).map((candidate) => candidate.id)).toEqual(['quoted-comma', 'plain'])

    const hashView = parseMobileSavedViewFile({
      relativePath: 'views/hash-tags.yml',
      content: `name: Hash Tags # regular comment
listPropertiesDisplay: ["Topic #", Status]
filters:
  all:
    - field: tags
      op: any_of
      value: ["AI # UX", Design] # regular comment
`,
    }, 0)

    expect(hashView?.definition.name).toBe('Hash Tags')
    expect(hashView?.definition.listPropertiesDisplay).toEqual(['Topic #', 'Status'])
    expect(evaluateMobileSavedView(requiredView(hashView), [
      note({ id: 'hash-content', tags: ['AI # UX'] }),
      note({ id: 'plain', tags: ['Design'] }),
      note({ id: 'hash-prefix-only', tags: ['AI'] }),
    ]).map((candidate) => candidate.id)).toEqual(['hash-content', 'plain'])
  })

  it('parses desktop YAML escaped scalars and null shorthands', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/escaped-scalars.yml',
      content: String.raw`name: "Luca \"Focus\" \u2605"
icon: "~"
color: ~
listPropertiesDisplay: ["Quote \"A\"", 'Owner''s Status']
filters:
  all:
    - field: title
      op: equals
      value: "Mobile\nQA"
    - field: priority
      op: equals
      value:
    - field: category
      op: equals
      value: ~
`,
    }, 0)

    expect(view?.definition).toMatchObject({
      color: null,
      icon: '~',
      listPropertiesDisplay: ['Quote "A"', "Owner's Status"],
      name: 'Luca "Focus" \u2605',
    })
    expect(view?.definition.filters).toMatchObject({
      all: [
        { field: 'title', op: 'equals', value: 'Mobile\nQA' },
        { field: 'priority', op: 'equals', value: null },
        { field: 'category', op: 'equals', value: null },
      ],
    })
    expect(evaluateMobileSavedView(requiredView(view), [
      note({ id: 'missing-null-fields', title: 'Mobile\nQA' }),
      note({ id: 'empty-priority', properties: [{ key: 'priority', label: 'Priority', value: '' }], title: 'Mobile\nQA' }),
      note({ id: 'literal-backslash', title: String.raw`Mobile\nQA` }),
    ]).map((candidate) => candidate.id)).toEqual(['missing-null-fields', 'empty-priority'])
  })

  it('sorts saved views with desktop custom-property sort strings', () => {
    const parsedView = (name: string, sort: string, order: number) => parseMobileSavedViewFile({ content: `name: ${name}\nsort: "${sort}"\nfilters:\n  all: []\n`, relativePath: `views/${name.toLowerCase().replace(/\s+/gu, '-')}.yml` }, order)
    const rankedView = parsedView('Ranked', 'property:Priority:asc', 0)
    const datedView = parsedView('Dated', 'Due:desc', 1)
    const offsetDateView = parsedView('Offset Dates', 'property:Due:asc', 2)
    const typePropertyView = parsedView('Type Property', 'type:asc', 3)
    const notes = [
      note({ id: 'missing' }),
      note({ id: 'low', properties: [{ key: 'Priority', label: 'Priority', value: 3 }, { key: 'Due', label: 'Due', value: '2026-06-10' }] }),
      note({ id: 'high', properties: [{ key: 'Priority', label: 'Priority', value: 1 }, { key: 'Due', label: 'Due', value: '2026-06-20' }] }),
    ]

    expect(evaluateMobileSavedView(requiredView(rankedView), notes).map((candidate) => candidate.id)).toEqual(['high', 'low', 'missing'])
    expect(evaluateMobileSavedView(requiredView(datedView), notes).map((candidate) => candidate.id)).toEqual(['high', 'low', 'missing'])
    expect(evaluateMobileSavedView(requiredView(offsetDateView), [
      note({ id: 'late-us-evening', properties: [{ key: 'Due', label: 'Due', value: '2026-06-10T23:00:00-05:00' }] }),
      note({ id: 'utc-midnight', properties: [{ key: 'Due', label: 'Due', value: '2026-06-11T00:00:00Z' }] }),
    ]).map((candidate) => candidate.id)).toEqual(['utc-midnight', 'late-us-evening'])
    expect(evaluateMobileSavedView(requiredView(typePropertyView), [
      note({ id: 'missing', type: 'Book' }),
      note({ id: 'frontmatter-zeta', properties: [{ key: 'type', label: 'type', value: 'Zeta' }], type: 'Essay' }),
      note({ id: 'frontmatter-alpha', properties: [{ key: 'type', label: 'type', value: 'Alpha' }], type: 'Procedure' }),
    ]).map((candidate) => candidate.id)).toEqual(['frontmatter-alpha', 'frontmatter-zeta', 'missing'])
  })

  it('sorts desktop scalar-array custom properties by the whole array text', () => {
    const view = parseMobileSavedViewFile({
      content: 'name: Ranked Tags\nsort: "property:Tags:asc"\nfilters:\n  all: []\n',
      relativePath: 'views/ranked-tags.yml',
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({ id: 'same-first-late', properties: [{ key: 'Tags', label: 'Tags', value: ['alpha', 'zeta'] }] }),
      note({ id: 'same-first-early', properties: [{ key: 'Tags', label: 'Tags', value: ['alpha', 'beta'] }] }),
      note({ id: 'later-first', properties: [{ key: 'Tags', label: 'Tags', value: ['bravo'] }] }),
    ]).map((candidate) => candidate.id)).toEqual(['same-first-early', 'same-first-late', 'later-first'])
  })

  it('sorts saved views with desktop built-in sort semantics', () => {
    const createdView = parseMobileSavedViewFile(
      { content: 'name: Created\nsort: "created:desc"\nfilters:\n  all: []\n', relativePath: 'views/created.yml' },
      0,
    )
    const statusView = parseMobileSavedViewFile(
      { content: 'name: Status\nsort: "status:asc"\nfilters:\n  all: []\n', relativePath: 'views/status.yml' },
      1,
    )

    expect(evaluateMobileSavedView(requiredView(createdView), [
      note({ createdAt: null, id: 'missing-created-newer-modified', modifiedAt: 3000 }),
      note({ createdAt: 2000, id: 'created-middle', modifiedAt: 1000 }),
      note({ createdAt: 1000, id: 'created-older', modifiedAt: 5000 }),
    ]).map((candidate) => candidate.id)).toEqual(['missing-created-newer-modified', 'created-middle', 'created-older'])

    expect(evaluateMobileSavedView(requiredView(statusView), [
      note({ id: 'done', modifiedAt: 1000, status: 'Done' }),
      note({ id: 'active-older', modifiedAt: 1000, status: 'Active' }),
      note({ id: 'empty-status', modifiedAt: 4000, status: '' }),
      note({ id: 'paused', modifiedAt: 1000, status: 'Paused' }),
      note({ id: 'active-newer', modifiedAt: 3000, status: 'Active' }),
    ]).map((candidate) => candidate.id)).toEqual(['active-newer', 'active-older', 'paused', 'done', 'empty-status'])
  })

  it('supports relationship and custom-property fields in saved-view filters', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/blocked-mobile.yml',
      content: `name: Blocked Mobile
filters:
  all:
    - field: depends_on
      op: contains
      value: Expo
    - field: priority
      op: equals
      value: High
`,
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({
        id: 'match',
        properties: [{ key: 'priority', label: 'Priority', value: 'High' }],
        relationships: [
          {
            key: 'depends_on',
            kind: 'custom',
            values: [{ title: 'Expo Layout QA', type: 'Procedure', typeTone: 'purple' }],
          },
        ],
      }),
      note({
        id: 'wrong-priority',
        properties: [{ key: 'priority', label: 'Priority', value: 'Low' }],
        relationships: [
          {
            key: 'depends_on',
            kind: 'custom',
            values: [{ title: 'Expo Layout QA', type: 'Procedure', typeTone: 'purple' }],
          },
        ],
      }),
    ]).map((candidate) => candidate.id)).toEqual(['match'])
  })

  it('filters relationship fields by desktop frontmatter key instead of relationship category', () => {
    const hasView = parseMobileSavedViewFile({
      relativePath: 'views/has-roadmap.yml',
      content: `name: Has Roadmap
filters:
  all:
    - field: has
      op: contains
      value: Roadmap
`,
    }, 0)
    const customHasView = parseMobileSavedViewFile({
      relativePath: 'views/has-part-roadmap.yml',
      content: `name: Has Part Roadmap
filters:
  all:
    - field: has_part
      op: contains
      value: Roadmap
`,
    }, 1)
    const belongsToView = parseMobileSavedViewFile({
      relativePath: 'views/belongs-to-roadmap.yml',
      content: `name: Belongs To Roadmap
filters:
  all:
    - field: belongs_to
      op: contains
      value: Roadmap
`,
    }, 2)
    const notes = [
      note({
        id: 'canonical-has',
        relationships: [{
          key: 'has',
          kind: 'has',
          values: [{ title: 'Roadmap', type: 'Note', typeTone: 'gray' }],
        }],
      }),
      note({
        id: 'custom-has-part',
        relationships: [{
          key: 'has_part',
          kind: 'has',
          values: [{ title: 'Roadmap', type: 'Note', typeTone: 'gray' }],
        }],
      }),
      note({
        id: 'label-only-belongs-to',
        relationships: [{
          kind: 'belongsTo',
          label: 'Belongs to',
          values: [{ title: 'Roadmap', type: 'Note', typeTone: 'gray' }],
        }],
      }),
    ]

    expect(evaluateMobileSavedView(requiredView(hasView), notes).map((candidate) => candidate.id)).toEqual(['canonical-has'])
    expect(evaluateMobileSavedView(requiredView(customHasView), notes).map((candidate) => candidate.id)).toEqual(['custom-has-part'])
    expect(evaluateMobileSavedView(requiredView(belongsToView), notes).map((candidate) => candidate.id)).toEqual(['label-only-belongs-to'])
  })

  it('evaluates discoverable desktop built-in saved-view fields', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/procedure-docs.yml',
      content: `name: Procedure Docs
filters:
  all:
    - field: isa
      op: equals
      value: Procedure
    - field: filename
      op: contains
      value: runbook
    - field: favorite
      op: equals
      value: true
    - field: body
      op: contains
      value: checklist
`,
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({
        favorite: true,
        id: 'Procedures/mobile-runbook.md',
        path: 'Procedures/mobile-runbook.md',
        snippet: 'Release checklist and QA steps',
        type: 'Procedure',
      }),
      note({
        favorite: true,
        id: 'Procedures/mobile-runbook-draft.md',
        path: 'Procedures/mobile-runbook-draft.md',
        snippet: 'Draft without the keyword',
        type: 'Procedure',
      }),
      note({
        favorite: true,
        id: 'Procedures/mobile-guide.md',
        path: 'Procedures/mobile-guide.md',
        snippet: 'Release checklist and QA steps',
        type: 'Procedure',
      }),
    ]).map((candidate) => candidate.id)).toEqual(['Procedures/mobile-runbook.md'])
  })

  it('resolves desktop-non-built-in filter fields through custom properties', () => {
    const view = parseMobileSavedViewFile({ content: 'name: Custom\nfilters:\n  all:\n    - field: created\n      op: equals\n      value: 2026-06-01\n    - field: modified\n      op: equals\n      value: custom-modified\n    - field: path\n      op: equals\n      value: Roadmap\n    - field: organized\n      op: equals\n      value: planned\n', relativePath: 'views/custom.yml' }, 0)
    const notes = [note({ createdAt: Date.parse('2020-01-01'), id: 'custom-property-match', modifiedAt: Date.parse('2020-01-02'), organized: false, path: 'Actual/Location.md', properties: [{ key: 'created', label: 'created', value: '2026-06-01' }, { key: 'modified', label: 'modified', value: 'custom-modified' }, { key: 'path', label: 'path', value: 'Roadmap' }, { key: 'organized', label: 'organized', value: 'planned' }] }), note({ createdAt: Date.parse('2026-06-01'), id: 'metadata-only-match', modifiedAt: Date.parse('2020-01-02'), organized: true, path: 'Roadmap' })]
    expect(evaluateMobileSavedView(requiredView(view), notes).map((candidate) => candidate.id)).toEqual(['custom-property-match'])
  })
})
