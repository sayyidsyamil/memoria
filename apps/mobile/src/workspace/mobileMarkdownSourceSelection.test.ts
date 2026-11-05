import { describe, expect, it } from 'vitest'
import { mobileMarkdownSelectionAfterTextChange } from './mobileMarkdownSourceSelection'

describe('mobile markdown source selection', () => {
  it('keeps the cursor after inserted text in the middle of the document', () => {
    expect(mobileMarkdownSelectionAfterTextChange(
      'Intro\n\nFollow up today',
      'Intro\n\nFollow up with Maria today',
      { start: 17, end: 17 },
    )).toEqual({ start: 28, end: 28 })
  })

  it('collapses after replacement text when a selected range changes', () => {
    expect(mobileMarkdownSelectionAfterTextChange(
      'Intro\n\nFollow up today',
      'Intro\n\nFollow up tomorrow',
      { start: 17, end: 22 },
    )).toEqual({ start: 25, end: 25 })
  })

  it('moves the cursor to the deletion point for backspace-style edits', () => {
    expect(mobileMarkdownSelectionAfterTextChange(
      'Intro\n\nFollow up today',
      'Intro\n\nFollow today',
      { start: 17, end: 17 },
    )).toEqual({ start: 14, end: 14 })
  })

  it('clamps unchanged selections to the current document length', () => {
    expect(mobileMarkdownSelectionAfterTextChange(
      'Short',
      'Short',
      { start: 20, end: 24 },
    )).toEqual({ start: 5, end: 5 })
  })
})
