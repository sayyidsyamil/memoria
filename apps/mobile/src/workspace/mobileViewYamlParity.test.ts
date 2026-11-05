import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { evaluateMobileSavedView, parseMobileSavedViewFile } from './mobileSavedViews'

describe('desktop YAML view interoperability', () => {
  it.each([
    'filters:\n  all:\n  - field: type\n    op: equals\n    value: Essay\n',
    'filters: { all: [{ field: type, op: equals, value: Essay }] }\n',
    'filters:\n    all:\n        - field: type\n          op: equals\n          value: Essay\n',
  ])('evaluates valid YAML regardless of indentation and flow style', (filters) => {
    const notes = workspaceScenarioForId('default').notes
    const view = parseMobileSavedViewFile({ relativePath: 'views/essays.yml', content: `name: Essays\n${filters}` }, 0)
    expect(view).not.toBeNull()
    if (!view) throw new Error('Expected a valid saved view')
    expect(evaluateMobileSavedView(view, notes).map((note) => note.id))
      .toEqual(notes.filter((note) => note.type === 'Essay').map((note) => note.id))
  })

  it.each([
    'filters: [',
    'filters: { all: [{ field: type, op: unknown, value: Essay }] }',
    'filters: { all: [{ op: equals, value: Essay }] }',
    'filters: { unsupported: [] }',
  ])('never converts malformed filters into an all-notes view', (filters) => {
    expect(parseMobileSavedViewFile({ relativePath: 'views/broken.yml', content: filters }, 0)).toBeNull()
  })
})
