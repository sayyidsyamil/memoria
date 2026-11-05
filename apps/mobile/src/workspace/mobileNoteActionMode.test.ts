import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import type { MobileNote } from './mobileWorkspaceModel'
import {
  isMobileMarkdownActionNote,
  isMobileNonMarkdownActionNote,
  isMobileTextLikeActionNote,
  mobileNoteActionMode,
} from './mobileNoteActionMode'

describe('mobile note action mode', () => {
  it('classifies selected notes for shared command and More-sheet availability', () => {
    const markdownNote = selectedNote({})
    const legacyMarkdownNote = selectedNote({ fileKind: undefined })
    const textFile = selectedNote({ fileKind: 'text' })
    const binaryFile = selectedNote({ fileKind: 'binary' })

    expect(mobileNoteActionMode(markdownNote)).toBe('markdown-note')
    expect(mobileNoteActionMode(legacyMarkdownNote)).toBe('markdown-note')
    expect(mobileNoteActionMode(textFile)).toBe('text-file')
    expect(mobileNoteActionMode(binaryFile)).toBe('binary-file')

    expect(isMobileMarkdownActionNote(markdownNote)).toBe(true)
    expect(isMobileMarkdownActionNote(textFile)).toBe(false)
    expect(isMobileMarkdownActionNote(null)).toBe(false)

    expect(isMobileNonMarkdownActionNote(markdownNote)).toBe(false)
    expect(isMobileNonMarkdownActionNote(textFile)).toBe(true)
    expect(isMobileNonMarkdownActionNote(binaryFile)).toBe(true)

    expect(isMobileTextLikeActionNote(markdownNote)).toBe(true)
    expect(isMobileTextLikeActionNote(textFile)).toBe(true)
    expect(isMobileTextLikeActionNote(binaryFile)).toBe(false)
    expect(isMobileTextLikeActionNote(null)).toBe(false)
  })
})

function selectedNote(overrides: Partial<MobileNote>): MobileNote {
  return {
    ...requiredFixture(workspaceScenarios.default.notes[0]),
    ...overrides,
  }
}
