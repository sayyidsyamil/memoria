import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEdit, applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import {
  mobileNoteWithResolvedWidth,
  normalizeMobileNoteWidth,
  resolveMobileNoteWidth,
  toggleMobileNoteWidth,
} from './mobileNoteWidth'

describe('normalizeMobileNoteWidth', () => {
  it.each([
    ['normal', 'normal'],
    ['wide', 'wide'],
    [' Wide ', 'wide'],
  ] as const)('normalizes desktop note width value %s', (value, expected) => {
    expect(normalizeMobileNoteWidth(value)).toBe(expected)
  })

  it.each(['expanded', '', null, 2])('rejects unsupported note width value %s', (value) => {
    expect(normalizeMobileNoteWidth(value)).toBeNull()
  })
})

describe('toggleMobileNoteWidth', () => {
  it.each([
    [null, 'wide'],
    ['normal', 'wide'],
    ['wide', 'normal'],
  ] as const)('toggles %s to %s', (value, expected) => {
    expect(toggleMobileNoteWidth(value)).toBe(expected)
  })
})

describe('resolveMobileNoteWidth', () => {
  it('prefers explicit note width over the persisted default', () => {
    expect(resolveMobileNoteWidth('normal', 'wide')).toBe('normal')
    expect(resolveMobileNoteWidth(null, 'wide')).toBe('wide')
    expect(resolveMobileNoteWidth(null, null)).toBe('normal')
  })

  it('resolves note objects without mutating the source note', () => {
    const note = requiredFixture(workspaceScenarioForId('default').notes[0])
    const resolved = mobileNoteWithResolvedWidth(note, 'wide')

    expect(note.noteWidth).toBeUndefined()
    expect(resolved.noteWidth).toBe('wide')
  })
})

describe('mobile note width metadata', () => {
  it('re-derives desktop note width metadata after note content edits', () => {
    const snapshot = applyMobileWorkspaceEdit(workspaceScenarioForId('default'), {
      content: '---\ntype: Essay\n_width: wide\n---\n# Revised Mobile Essay\n\nA body.\n',
      noteId: 'workflow-orchestration',
      type: 'updateNoteContent',
    })

    const note = snapshot.notes.find((candidate) => candidate.id === 'workflow-orchestration')
    expect(note?.noteWidth).toBe('wide')
  })

  it('persists note width through the canonical desktop _width key', () => {
    const result = applyMobileWorkspaceEdit(workspaceScenarioForId('default'), {
      key: 'width',
      noteId: 'workflow-orchestration',
      type: 'updateProperty',
      value: 'wide',
    })

    const note = result.notes.find((candidate) => candidate.id === 'workflow-orchestration')
    expect(note?.rawContent).toContain('_width: wide')
    expect(note?.noteWidth).toBe('wide')
  })

  it('persists desktop-compatible default note width through vault config writes', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      mode: 'wide',
      type: 'setDefaultNoteWidth',
    })

    expect(result.snapshot.vaultConfig).toEqual({ defaultNoteWidth: 'wide' })
    expect(result.writes).toEqual([{
      config: { defaultNoteWidth: 'wide' },
      kind: 'saveVaultConfig',
    }])
  })
})
