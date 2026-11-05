import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import { workspaceScenarios } from '../../fixtures/workspaceFixtures'
import type { MobileNote } from '../../workspace/mobileWorkspaceModel'
import {
  isMobileMarkdownActionNote,
  isMobileTextLikeActionNote,
  mobileNoteMoreActionMode,
} from './MobileNoteMoreActionsModel'

describe('mobile note more actions model', () => {
  it('keeps visible editor actions aligned with text-like command availability', () => {
    const markdownNote = workspaceScenarios.default.notes[0]
    assert(markdownNote)
    const textFile = selectedFile({ fileKind: 'text' })
    const binaryFile = selectedFile({ fileKind: 'binary' })

    expect(mobileNoteMoreActionMode(markdownNote)).toBe('markdown-note')
    expect(isMobileMarkdownActionNote(markdownNote)).toBe(true)
    expect(isMobileTextLikeActionNote(markdownNote)).toBe(true)

    expect(mobileNoteMoreActionMode(textFile)).toBe('text-file')
    expect(isMobileMarkdownActionNote(textFile)).toBe(false)
    expect(isMobileTextLikeActionNote(textFile)).toBe(true)

    expect(mobileNoteMoreActionMode(binaryFile)).toBe('binary-file')
    expect(isMobileMarkdownActionNote(binaryFile)).toBe(false)
    expect(isMobileTextLikeActionNote(binaryFile)).toBe(false)
  })
})

function selectedFile(overrides: Partial<MobileNote>): MobileNote {
  const base = workspaceScenarios.default.notes[0]
  assert(base)
  return {
    ...base,
    ...overrides,
  }
}
