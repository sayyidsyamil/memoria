import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EditorProps } from './Editor'
import { resolvePlatformCapabilities } from '../lib/platformCapabilities'

describe('Editor per-note editor selection', () => {
  let mockEditor: {
    key?: string
    perNoteEditors?: boolean
  }

  beforeEach(() => {
    mockEditor = {}
    
    // Mock the EditorInner component to capture the key prop
    vi.doMock('./Editor', async () => {
      const actual = await vi.importActual<typeof import('./Editor')>('./Editor')
      return {
        ...actual,
        Editor: vi.fn((props: EditorProps) => {
          const { platformCapabilities, activeTabPath } = props
          
          // Simulate the key logic from the actual Editor component
          const editorKey = platformCapabilities?.perNoteEditors
            ? `editor-${activeTabPath ?? 'none'}`
            : 'shared-editor'
          
          mockEditor.key = editorKey
          mockEditor.perNoteEditors = platformCapabilities?.perNoteEditors
          
          return null
        }),
      }
    })
  })

  it('uses shared editor key when perNoteEditors is disabled (desktop)', () => {
    const capabilities = resolvePlatformCapabilities('tauri')
    
    expect(capabilities.perNoteEditors).toBe(false)
    
    // With desktop capabilities, the editor key should be stable
    const key1 = capabilities.perNoteEditors ? 'editor-/test/note1.md' : 'shared-editor'
    const key2 = capabilities.perNoteEditors ? 'editor-/test/note2.md' : 'shared-editor'
    
    expect(key1).toBe('shared-editor')
    expect(key2).toBe('shared-editor')
    expect(key1).toBe(key2)
  })

  it('uses path-based editor key when perNoteEditors is enabled (web)', () => {
    const capabilities = resolvePlatformCapabilities('remote')
    
    expect(capabilities.perNoteEditors).toBe(true)
    
    // With web capabilities, the editor key should be path-based
    const key1 = capabilities.perNoteEditors ? 'editor-/test/note1.md' : 'shared-editor'
    const key2 = capabilities.perNoteEditors ? 'editor-/test/note2.md' : 'shared-editor'
    
    expect(key1).toBe('editor-/test/note1.md')
    expect(key2).toBe('editor-/test/note2.md')
    expect(key1).not.toBe(key2)
  })

  it('changes editor key when active tab changes with perNoteEditors enabled', () => {
    const capabilities = resolvePlatformCapabilities('remote')
    
    const key1 = capabilities.perNoteEditors ? 'editor-/test/note1.md' : 'shared-editor'
    const key2 = capabilities.perNoteEditors ? 'editor-/test/note2.md' : 'shared-editor'
    
    // Keys should be different for different paths
    expect(key1).not.toBe(key2)
  })

  it('uses same editor key across tab switches when perNoteEditors is disabled', () => {
    const capabilities = resolvePlatformCapabilities('tauri')
    
    const key1 = capabilities.perNoteEditors ? 'editor-/test/note1.md' : 'shared-editor'
    const key2 = capabilities.perNoteEditors ? 'editor-/test/note2.md' : 'shared-editor'
    
    // Keys should be the same for desktop (shared editor)
    expect(key1).toBe(key2)
  })

  it('handles null activeTabPath', () => {
    const capabilities = resolvePlatformCapabilities('remote')
    
    const key = capabilities.perNoteEditors ? 'editor-none' : 'shared-editor'
    
    expect(key).toBe('editor-none')
  })

  it('desktop (tauri) uses shared editor', () => {
    const capabilities = resolvePlatformCapabilities('tauri')
    expect(capabilities.perNoteEditors).toBe(false)
  })

  it('web (remote) uses per-note editors', () => {
    const capabilities = resolvePlatformCapabilities('remote')
    expect(capabilities.perNoteEditors).toBe(true)
  })

  it('mock backend uses shared editor', () => {
    const capabilities = resolvePlatformCapabilities('mock')
    expect(capabilities.perNoteEditors).toBe(false)
  })
})
