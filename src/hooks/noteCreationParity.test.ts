import { describe, expect, it } from 'vitest'
import golden from '../../apps/server/test/fixtures/desktop-parity/steps.json'
import { buildNoteContent } from './useNoteCreation'

/**
 * The desktop parity suite (TOL-228) creates its notes with the content the server receives
 * from the web app. That content must stay what the app builds for a new note on either side.
 */

interface CreateStep {
  op: string
  path: string
  title: string
  type: string
  changed: Record<string, string>
}

function createSteps(): CreateStep[] {
  return (golden.steps as CreateStep[]).filter((step) => step.op === 'create')
}

describe('notes the desktop parity suite creates', () => {
  it('have the content the app builds for a new note', () => {
    const steps = createSteps()

    expect(steps.length).toBeGreaterThan(0)
    for (const { path, title, type, changed } of steps) {
      expect(new Map(Object.entries(changed)).get(path)).toBe(buildNoteContent({ title, type, status: null }))
    }
  })
})
