import { describe, expect, it } from 'vitest'
import { initialMobileEditorStateFromMode } from './mobileEditorMode'

describe('mobile editor mode URL state', () => {
  it('opens the default route in editable WYSIWYG mode', () => {
    expect(initialMobileEditorStateFromMode(null)).toEqual({
      initialEditorEditing: true,
      initialEditorEditingMode: 'wysiwyg',
    })
  })

  it('opens the source editor for raw-mode QA routes', () => {
    expect(initialMobileEditorStateFromMode('raw')).toEqual({
      initialEditorEditing: true,
      initialEditorEditingMode: 'source',
    })
    expect(initialMobileEditorStateFromMode('source')).toEqual({
      initialEditorEditing: true,
      initialEditorEditingMode: 'source',
    })
  })

  it('opens a read-only rendered editor for read-mode QA routes', () => {
    expect(initialMobileEditorStateFromMode('read')).toEqual({
      initialEditorEditing: false,
      initialEditorEditingMode: 'wysiwyg',
    })
  })

  it('opens the native TenTap editor for wysiwyg-mode QA routes', () => {
    expect(initialMobileEditorStateFromMode('wysiwyg')).toEqual({
      initialEditorEditing: true,
      initialEditorEditingMode: 'wysiwyg',
    })
  })
})
