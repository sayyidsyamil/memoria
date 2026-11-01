import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMobileSavedViewFilename, mobileSavedViewOrderUpdates, moveMobileSavedView, nextMobileSavedViewOrder, evaluateMobileSavedView, orderedMobileSavedViews, parseMobileSavedViewFile, serializeMobileSavedViewDefinition } from './mobileSavedViews'
import { note, relationship, viewFixture, requiredView } from './mobileSavedViewsTestFixtures'

describe('mobile saved views', () => {
  afterEach(() => vi.useRealTimers())


  it('round-trips nested desktop saved-view filter groups', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/nested-focus.yml',
      content: `name: Nested Focus
filters:
  all:
    - any:
        - field: type
          op: equals
          value: Project
        - all:
            - field: type
              op: equals
              value: Event
            - field: status
              op: equals
              value: Active
    - field: favorite
      op: equals
      value: true
`,
    }, 0)
    const notes = [
      note({ favorite: true, id: 'favorite-project', status: 'Draft', type: 'Project' }),
      note({ favorite: true, id: 'favorite-active-event', status: 'Active', type: 'Event' }),
      note({ favorite: true, id: 'favorite-draft-event', status: 'Draft', type: 'Event' }),
      note({ favorite: false, id: 'plain-project', status: 'Draft', type: 'Project' }),
    ]

    expect(evaluateMobileSavedView(requiredView(view), notes).map((candidate) => candidate.id)).toEqual([
      'favorite-project',
      'favorite-active-event',
    ])

    const serialized = serializeMobileSavedViewDefinition(requiredView(view).definition)
    const reparsed = parseMobileSavedViewFile({ content: serialized, relativePath: 'views/nested-focus.yml' }, 0)

    expect(serialized).toContain('    - any:')
    expect(serialized).toContain('        - all:')
    expect(evaluateMobileSavedView(requiredView(reparsed), notes).map((candidate) => candidate.id)).toEqual([
      'favorite-project',
      'favorite-active-event',
    ])
  })

  it('evaluates regex-enabled saved-view filters like desktop', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/regex.yml',
      content: `name: Regex
filters:
  all:
    - field: title
      op: contains
      value: '^Mobile\\s+QA'
      regex: true
`,
    }, 0)
    const invalidRegexView = parseMobileSavedViewFile({
      relativePath: 'views/invalid-regex.yml',
      content: `name: Invalid Regex
filters:
  all:
    - field: title
      op: contains
      value: "("
      regex: true
`,
    }, 1)
    const unsafeRegexView = parseMobileSavedViewFile({
      relativePath: 'views/unsafe-regex.yml',
      content: `name: Unsafe Regex
filters:
  all:
    - field: title
      op: contains
      value: "(a+)+$"
      regex: true
`,
    }, 2)
    const notes = [
      note({ id: 'match', title: 'Mobile QA Draft' }),
      note({ id: 'miss', title: 'Desktop QA Draft' }),
    ]

    expect(evaluateMobileSavedView(requiredView(view), notes).map((candidate) => candidate.id)).toEqual(['match'])
    expect(evaluateMobileSavedView(requiredView(invalidRegexView), notes)).toEqual([])
    expect(evaluateMobileSavedView(requiredView(unsafeRegexView), [
      note({ id: 'unsafe-would-match', title: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    ])).toEqual([])
  })

  it('matches relationship array filters with desktop wikilink semantics', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/session-trail.yml',
      content: `name: Session Trail
filters:
  all:
    - field: related_to
      op: equals
      value: svc-session-trail
`,
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({
        id: 'single',
        relationships: [relationship('related_to', [{ ref: '[[svc-session-trail]]', title: 'Trail' }])],
      }),
      note({
        id: 'aliased',
        relationships: [relationship('related_to', [{ ref: '[[svc-session-trail|Trail]]', title: 'Trail' }])],
      }),
      note({
        id: 'multiple',
        relationships: [relationship('related_to', [
          { ref: '[[svc-session-trail]]', title: 'Trail' },
          { ref: '[[other]]', title: 'Other' },
        ])],
      }),
    ]).map((candidate) => candidate.id)).toEqual(['single', 'aliased'])
  })

  it('keeps quoted desktop wikilink filter values as scalar strings', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/memoria-links.yml',
      content: `name: Memoria Links
filters:
  all:
    - field: related_to
      op: contains
      value: "[[memoria]]"
`,
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({
        id: 'match',
        relationships: [relationship('related_to', [{ ref: '[[memoria]]', title: 'Memoria' }])],
      }),
      note({
        id: 'miss',
        relationships: [relationship('related_to', [{ ref: '[[other]]', title: 'Other' }])],
      }),
    ]).map((candidate) => candidate.id)).toEqual(['match'])
  })

  it('uses exact desktop matching for property-array view filters', () => {
    const view = parseMobileSavedViewFile({
      relativePath: 'views/design-tags.yml',
      content: `name: Design Tags
filters:
  all:
    - field: tags
      op: contains
      value: Design
`,
    }, 0)

    expect(evaluateMobileSavedView(requiredView(view), [
      note({ id: 'exact', tags: ['Design'] }),
      note({ id: 'substring', tags: ['Design Systems'] }),
    ]).map((candidate) => candidate.id)).toEqual(['exact'])
  })

  it('matches relative date expressions in saved-view filters', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T12:00:00Z'))

    const todayView = parseMobileSavedViewFile({
      relativePath: 'views/today.yml',
      content: `name: Today
filters:
  all:
    - field: Date
      op: equals
      value: today
`,
    }, 0)
    const recentView = parseMobileSavedViewFile({
      relativePath: 'views/recent.yml',
      content: `name: Recent
filters:
  all:
    - field: Date
      op: after
      value: 10 days ago
`,
    }, 1)
    const upcomingView = parseMobileSavedViewFile({
      relativePath: 'views/upcoming.yml',
      content: `name: Upcoming
filters:
  all:
    - field: Date
      op: equals
      value: in 2 weeks
`,
    }, 2)
    const notes = [
      note({ id: 'older', properties: [{ key: 'Date', label: 'Date', value: '2026-03-20' }] }),
      note({ id: 'recent', properties: [{ key: 'Date', label: 'Date', value: '2026-03-30' }] }),
      note({ id: 'today', properties: [{ key: 'Date', label: 'Date', value: '2026-04-07' }] }),
      note({ id: 'upcoming', properties: [{ key: 'Date', label: 'Date', value: '2026-04-21' }] }),
    ]

    expect(evaluateMobileSavedView(requiredView(todayView), notes).map((candidate) => candidate.id)).toEqual(['today'])
    expect(evaluateMobileSavedView(requiredView(recentView), notes).map((candidate) => candidate.id)).toEqual(['recent', 'today', 'upcoming'])
    expect(evaluateMobileSavedView(requiredView(upcomingView), notes).map((candidate) => candidate.id)).toEqual(['upcoming'])
  })

  it('clamps relative month and year filters to desktop date-fns calendar semantics', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 31, 12))

    const oneMonthAgoView = parseMobileSavedViewFile({
      relativePath: 'views/month-ago.yml',
      content: `name: Month Ago
filters:
  all:
    - field: Date
      op: equals
      value: one month ago
`,
    }, 0)
    const nextMonthView = parseMobileSavedViewFile({
      relativePath: 'views/next-month.yml',
      content: `name: Next Month
filters:
  all:
    - field: Date
      op: equals
      value: in one month
`,
    }, 1)
    const notes = [
      note({ id: 'desktop-month-past', properties: [{ key: 'Date', label: 'Date', value: '2026-02-28' }] }),
      note({ id: 'native-rollover-past', properties: [{ key: 'Date', label: 'Date', value: '2026-03-03' }] }),
      note({ id: 'desktop-month-future', properties: [{ key: 'Date', label: 'Date', value: '2026-04-30' }] }),
      note({ id: 'native-rollover-future', properties: [{ key: 'Date', label: 'Date', value: '2026-05-01' }] }),
    ]

    expect(evaluateMobileSavedView(requiredView(oneMonthAgoView), notes).map((candidate) => candidate.id)).toEqual(['desktop-month-past'])
    expect(evaluateMobileSavedView(requiredView(nextMonthView), notes).map((candidate) => candidate.id)).toEqual(['desktop-month-future'])

    vi.setSystemTime(new Date(2024, 1, 29, 12))
    const lastYearView = parseMobileSavedViewFile({
      relativePath: 'views/last-year.yml',
      content: `name: Last Year
filters:
  all:
    - field: Date
      op: equals
      value: one year ago
`,
    }, 2)

    expect(evaluateMobileSavedView(requiredView(lastYearView), [
      note({ id: 'desktop-year-past', properties: [{ key: 'Date', label: 'Date', value: '2023-02-28' }] }),
      note({ id: 'native-rollover-year', properties: [{ key: 'Date', label: 'Date', value: '2023-03-01' }] }),
    ]).map((candidate) => candidate.id)).toEqual(['desktop-year-past'])
  })

  it('rejects invalid ISO date-only values like desktop saved-view filters', () => {
    const invalidTargetView = parseMobileSavedViewFile({
      relativePath: 'views/invalid-target-date.yml',
      content: `name: Invalid Target Date
filters:
  all:
    - field: Date
      op: equals
      value: 2026-02-31
`,
    }, 0)
    const validTargetView = parseMobileSavedViewFile({
      relativePath: 'views/valid-target-date.yml',
      content: `name: Valid Target Date
filters:
  all:
    - field: Date
      op: equals
      value: 2026-03-03
`,
    }, 1)

    expect(evaluateMobileSavedView(requiredView(invalidTargetView), [
      note({ id: 'normalized-target-would-be-wrong', properties: [{ key: 'Date', label: 'Date', value: '2026-03-03' }] }),
    ])).toEqual([])
    expect(evaluateMobileSavedView(requiredView(validTargetView), [
      note({ id: 'normalized-field-would-be-wrong', properties: [{ key: 'Date', label: 'Date', value: '2026-02-31' }] }),
    ])).toEqual([])
  })

  it('serializes desktop-compatible saved-view YAML that can be parsed back', () => {
    const content = serializeMobileSavedViewDefinition({
      color: 'purple',
      filters: {
        all: [
          { field: 'type', op: 'equals', value: 'Procedure' },
          { field: 'status', op: 'any_of', value: ['Active', 'Draft'] },
        ],
      },
      icon: null,
      listPropertiesDisplay: ['Status', 'belongs_to'],
      name: 'Active Procedures',
      sort: 'modified:desc',
    })
    const parsed = parseMobileSavedViewFile({ content, relativePath: 'views/active-procedures.yml' }, 0)

    expect(content).toContain('name: "Active Procedures"')
    expect(content).toContain('listPropertiesDisplay:')
    expect(content).toContain('filters:')
    expect(parsed?.definition).toMatchObject({
      color: 'purple',
      filters: {
        all: [
          { field: 'type', op: 'equals', value: 'Procedure' },
          { field: 'status', op: 'any_of', value: ['Active', 'Draft'] },
        ],
      },
      listPropertiesDisplay: ['Status', 'belongs_to'],
      name: 'Active Procedures',
      sort: 'modified:desc',
    })
  })

  it('creates desktop-style unique view filenames', () => {
    expect(createMobileSavedViewFilename(' Project / Q2: Launch 🚀 ')).toBe('project-q2-launch.yml')
    expect(createMobileSavedViewFilename('你好')).toBe('你好.yml')
    expect(createMobileSavedViewFilename('🚀')).toBe('view.yml')
    expect(createMobileSavedViewFilename('Active Procedures', ['active-procedures.yml'])).toBe('active-procedures-2.yml')
    expect(createMobileSavedViewFilename('Roadmap', ['Roadmap.yml'])).toBe('roadmap-2.yml')
    expect(createMobileSavedViewFilename('CON', [])).toBe('con-view.yml')
  })

  it('assigns new saved views after the highest desktop order', () => {
    expect(nextMobileSavedViewOrder([
      viewFixture('alpha.yml', 'Alpha', 0),
      viewFixture('beta.yml', 'Beta', 4),
      viewFixture('gamma.yml', 'Gamma', null),
    ])).toBe(5)
    expect(nextMobileSavedViewOrder([
      viewFixture('alpha.yml', 'Alpha', null),
      viewFixture('beta.yml', 'Beta', null),
    ])).toBe(2)
  })

  it('orders saved views by desktop order and filename instead of display name', () => {
    expect(orderedMobileSavedViews([
      viewFixture('zeta.yml', 'Alpha', null),
      viewFixture('alpha.yml', 'Zeta', null),
      viewFixture('middle.yml', 'Middle', 20),
      viewFixture('first.yml', 'First', 10),
    ]).map((view) => view.filename)).toEqual([
      'first.yml',
      'middle.yml',
      'alpha.yml',
      'zeta.yml',
    ])
  })

  it('moves saved views and builds dense desktop order updates', () => {
    const views = [
      viewFixture('alpha.yml', 'Alpha', 0),
      viewFixture('beta.yml', 'Beta', 1),
      viewFixture('gamma.yml', 'Gamma', 2),
    ]
    const moved = moveMobileSavedView(views, 'view-gamma', 'up')

    expect(moved?.map((view) => view.filename)).toEqual(['alpha.yml', 'gamma.yml', 'beta.yml'])
    expect(mobileSavedViewOrderUpdates(moved ?? []).map(({ filename, definition }) => ({
      filename,
      order: definition.order,
    }))).toEqual([
      { filename: 'alpha.yml', order: 0 },
      { filename: 'gamma.yml', order: 1 },
      { filename: 'beta.yml', order: 2 },
    ])
    expect(moveMobileSavedView(views, 'alpha.yml', 'up')).toBeNull()
  })
})
