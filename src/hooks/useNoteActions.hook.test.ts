import { invoke } from '@tauri-apps/api/core'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as frontmatterText from '../lib/frontmatterText'
import { GITIGNORED_VISIBILITY_APPLIED_EVENT } from '../lib/gitignoredVisibilityEvents'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { clearNoteContentCache, getCachedNoteContentEntry } from './noteContentCache'
import type { NoteActionsConfig } from './useNoteActions'
import { useNoteActions } from './useNoteActions'
import { RAPID_CREATE_NOTE_SETTLE_MS } from './useNoteCreation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/Users/luca/Laputa/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
  ...overrides,
})

describe('useNoteActions hook', () => {
  const addEntry = vi.fn()
  const removeEntry = vi.fn()
  const updateEntry = vi.fn()
  const setToastMessage = vi.fn()

  const makeConfig = (entries: VaultEntry[] = []): NoteActionsConfig => ({
    addEntry, removeEntry, entries, setToastMessage, updateEntry, vaultPath: '/test/vault',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockReset()
    vi.mocked(isTauri).mockReturnValue(false)
    clearNoteContentCache()
    vi.useRealTimers()
  })

  function renderActions(entries: VaultEntry[] = []) {
    return renderHook(() => useNoteActions(makeConfig(entries)))
  }

  async function flushAsyncWork() {
    await Promise.resolve()
    await Promise.resolve()
  }

  async function createImmediateEntry(type?: string) {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const { result } = renderActions()
    await act(async () => {
      result.current.handleCreateNoteImmediate(type)
      await flushAsyncWork()
    })
    const [createdEntry] = addEntry.mock.calls[0]
    vi.restoreAllMocks()
    return createdEntry as VaultEntry
  }

  it.each([
    {
      name: 'handleCreateNote',
      run: (result: ReturnType<typeof renderActions>['result']) => result.current.handleCreateNote('Test Note', 'Note'),
      expectedTitle: 'Test Note',
      expectedType: 'Note',
      expectedPathFragment: 'test-note.md',
    },
    {
      name: 'handleCreateType',
      run: (result: ReturnType<typeof renderActions>['result']) => result.current.handleCreateType('Recipe'),
      expectedTitle: 'Recipe',
      expectedType: 'Type',
      expectedPathFragment: 'recipe.md',
    },
  ])('$name creates the expected entry', async ({ run, expectedTitle, expectedType, expectedPathFragment }) => {
    const { result } = renderActions()

    await act(async () => {
      await run(result)
    })

    expect(addEntry).toHaveBeenCalledTimes(1)
    const [createdEntry] = addEntry.mock.calls[0]
    expect(createdEntry.title).toBe(expectedTitle)
    expect(createdEntry.isA).toBe(expectedType)
    expect(createdEntry.path).toContain(expectedPathFragment)
  })

  it('handleCreateNote opens tab immediately (before addEntry resolves)', () => {
    const callOrder: string[] = []
    const trackedAddEntry = vi.fn(() => { callOrder.push('addEntry') })
    const config = makeConfig()
    config.addEntry = trackedAddEntry

    const { result } = renderHook(() => useNoteActions(config))

    act(() => {
      result.current.handleCreateNote('Fast Note', 'Note')
    })

    // Tab should be open with the new note
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0].entry.title).toBe('Fast Note')
    expect(result.current.activeTabPath).toContain('fast-note.md')
  })

  it('handleNavigateWikilink finds entry by title', async () => {
    const target = makeEntry({ title: 'Target Note', path: '/vault/target.md' })

    const { result } = renderHook(() => useNoteActions(makeConfig([target])))

    await act(async () => {
      result.current.handleNavigateWikilink('Target Note')
    })

    expect(result.current.activeTabPath).toBe('/vault/target.md')
  })

  it.each(['html', 'HTM'])('loads .%s vault files into the editor for in-app preview', async (extension) => {
    const entry = makeEntry({
      path: `/test/vault/generated/report.${extension}`,
      filename: `report.${extension}`,
      fileKind: 'text',
    })
    const onOpenExternalFile = vi.fn()
    const config = { ...makeConfig([entry]), onOpenExternalFile }
    const { result } = renderHook(() => useNoteActions(config))

    await act(async () => {
      await result.current.handleSelectNote(entry)
    })

    expect(onOpenExternalFile).not.toHaveBeenCalled()
    expect(result.current.tabs).toEqual([{ entry, content: '' }])
    expect(result.current.activeTabPath).toBe(entry.path)
    expect(mockInvoke).toHaveBeenCalledWith('get_note_content', expect.objectContaining({
      path: entry.path,
    }))
  })

  it('handleNavigateWikilink warns when target not found', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useNoteActions(makeConfig()))

    act(() => {
      result.current.handleNavigateWikilink('Nonexistent')
    })

    expect(warnSpy).toHaveBeenCalledWith('Navigation target not found: Nonexistent')
    warnSpy.mockRestore()
  })

  it('keeps the active tab open when gitignored visibility reports a /tmp alias', async () => {
    const activeEntry = makeEntry({
      path: '/private/tmp/memoria-vault/active.md',
      filename: 'active.md',
      title: 'Active',
    })
    const { result } = renderActions([activeEntry])

    await act(async () => {
      await result.current.handleSelectNote(activeEntry)
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(GITIGNORED_VISIBILITY_APPLIED_EVENT, {
        detail: {
          hide: true,
          visiblePaths: ['/tmp/memoria-vault/active.md'],
        },
      }))
    })

    expect(result.current.activeTabPath).toBe('/private/tmp/memoria-vault/active.md')
    expect(result.current.tabs).toHaveLength(1)
  })

  it('handleUpdateFrontmatter calls updateEntry with mapped patch', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Done' })
    expect(setToastMessage).toHaveBeenCalledWith('Property updated')
  })

  it('does not rerender for unopened-note frontmatter content refreshes', async () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useNoteActions(makeConfig())
    })
    const initialRenders = renders

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/unopened.md', 'status', 'Done', { silent: true })
    })

    expect(result.current.tabs).toEqual([])
    expect(renders).toBe(initialRenders)
    expect(updateEntry).toHaveBeenCalledWith('/vault/unopened.md', { status: 'Done' })
  })

  it('marks Tauri frontmatter writes as internal before invoking the command', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const order: string[] = []
    const onInternalVaultWrite = vi.fn((path: string) => {
      order.push(`mark:${path}`)
    })
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(`invoke:${String(command)}`)
      return '---\nstatus: Done\n---\nBody'
    })

    const { result } = renderHook(() => useNoteActions({
      ...makeConfig(),
      onInternalVaultWrite,
    }))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(onInternalVaultWrite).toHaveBeenCalledWith('/vault/note.md')
    expect(order).toEqual(['mark:/vault/note.md', 'invoke:update_frontmatter'])
  })

  it('handleUpdateFrontmatter syncs is_a and color changes to entries', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'is_a', 'Project')
    })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { isA: 'Project' })

    vi.clearAllMocks()
    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'color', 'blue')
    })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { color: 'blue' })
  })

  it('records successful frontmatter updates for undo and redo', async () => {
    const entry = makeEntry({ path: '/vault/note.md', status: 'Active' })
    const { result } = renderHook(() => useNoteActions(makeConfig([entry])))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done')
    })

    expect(result.current.canUndo).toBe(true)
    expect(result.current.undoLabel).toBe('Update status')

    await act(async () => {
      await result.current.handleUndo()
    })
    await act(async () => {
      await result.current.handleRedo()
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Done' })
    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: 'Active' })
    expect(updateEntry).toHaveBeenLastCalledWith('/vault/note.md', { status: 'Done' })
  })

  it('does not record silent or failed frontmatter updates', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const entry = makeEntry({ path: '/vault/note.md', status: 'Active' })
    const { result } = renderHook(() => useNoteActions(makeConfig([entry])))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Done', { silent: true })
    })
    expect(result.current.canUndo).toBe(false)

    vi.spyOn(frontmatterText, 'updateFrontmatterContent').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'status', 'Blocked')
    })

    expect(result.current.canUndo).toBe(false)
    errorSpy.mockRestore()
  })

  it('handleDeleteProperty calls updateEntry with null/default values', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleDeleteProperty('/vault/note.md', 'status')
    })

    expect(updateEntry).toHaveBeenCalledWith('/vault/note.md', { status: null })
    expect(setToastMessage).toHaveBeenCalledWith('Property deleted')
  })

  it('ignores guarded inspector property deletes after the active note changes', async () => {
    const noteA = makeEntry({ path: '/vault/note-a.md', filename: 'note-a.md', title: 'Note A' })
    const noteB = makeEntry({ path: '/vault/note-b.md', filename: 'note-b.md', title: 'Note B' })
    const { result } = renderHook(() => useNoteActions(makeConfig([noteA, noteB])))

    act(() => {
      result.current.handleSwitchTab(noteB.path)
    })
    await act(async () => {
      await result.current.handleDeleteProperty(noteA.path, 'status', { requireActivePath: noteA.path })
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('keeps property-only frontmatter writes in the note cache after a note switch wins the apply guard', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const noteA = makeEntry({ path: '/vault/note-a.md', filename: 'note-a.md', title: 'Note A' })
    const noteB = makeEntry({ path: '/vault/note-b.md', filename: 'note-b.md', title: 'Note B' })
    const updatedContent = '---\nStatus: Done\n---\nBody'
    let resolveFrontmatterWrite: ((content: string) => void) | null = null
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => {
      resolveFrontmatterWrite = (content) => { resolve(content) }
    }))

    const { result } = renderHook(() => useNoteActions(makeConfig([noteA, noteB])))
    act(() => {
      result.current.handleSwitchTab(noteA.path)
    })

    let updatePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      updatePromise = result.current.handleUpdateFrontmatter(
        noteA.path,
        'Status',
        'Done',
        { requireActivePath: noteA.path },
      )
      await Promise.resolve()
    })
    act(() => {
      result.current.handleSwitchTab(noteB.path)
    })
    await act(async () => {
      resolveFrontmatterWrite?.(updatedContent)
      await updatePromise
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
    expect(getCachedNoteContentEntry(noteA.path)?.value).toBe(updatedContent)
  })

  it('handleCreateNoteImmediate creates note with timestamp-based title', async () => {
    const createdEntry = await createImmediateEntry()
    expect(createdEntry.title).toBe('Untitled Note 1700000000')
    expect(createdEntry.filename).toBe('untitled-note-1700000000.md')
    expect(createdEntry.isA).toBe('Note')
  })

  it('handleCreateNoteImmediate generates unique names on rapid calls via timestamp', async () => {
    vi.useFakeTimers()
    let ts = 1700000000000
    vi.spyOn(Date, 'now').mockImplementation(() => { ts += 1000; return ts })
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      result.current.handleCreateNoteImmediate()
      await flushAsyncWork()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushAsyncWork()
    })
    await act(async () => {
      vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS)
      await flushAsyncWork()
    })

    expect(addEntry).toHaveBeenCalledTimes(3)
    const filenames = addEntry.mock.calls.map(([e]: [VaultEntry]) => e.filename)
    // Each call consumes Date.now() multiple times, so just verify uniqueness and pattern
    expect(new Set(filenames).size).toBe(3)
    for (const fn of filenames) {
      expect(fn).toMatch(/^untitled-note-\d+\.md$/)
    }
    vi.restoreAllMocks()
  })

  it('handleCreateNoteImmediate accepts custom type', async () => {
    const createdEntry = await createImmediateEntry('Project')
    expect(createdEntry.filename).toMatch(/^untitled-project-\d+\.md$/)
    expect(createdEntry.isA).toBe('Project')
  })

  it('handleCreateNote leaves Project body empty without an explicit type template', () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    act(() => {
      result.current.handleCreateNote('My Project', 'Project')
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toBe('---\ntitle: My Project\ntype: Project\n---\n')
  })

  it('handleCreateNote uses custom template from type entry', () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Recipe', template: '## Ingredients\n\n## Steps\n\n' })
    const { result } = renderHook(() => useNoteActions(makeConfig([typeEntry])))

    act(() => {
      result.current.handleCreateNote('Pasta', 'Recipe')
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toContain('## Ingredients')
    expect(tabContent).toContain('## Steps')
  })

  it.each([
    ['Q&A', (entry: VaultEntry) => { expect(entry.isA).toBe('Q&A') }],
    ['+++', (entry: VaultEntry) => { expect(entry.filename).not.toBe('.md') }],
  ])('handleCreateNoteImmediate handles custom type "%s"', async (typeName, assertEntry) => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      expect(() => { result.current.handleCreateNoteImmediate(typeName) }).not.toThrow()
      await flushAsyncWork()
    })

    const [entry] = addEntry.mock.calls[0]
    expect(entry.path).not.toContain('//')
    assertEntry(entry)
  })

  it('handleCreateNoteImmediate uses template for typed notes', async () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Project', template: '## Custom Template\n\n' })
    const { result } = renderHook(() => useNoteActions(makeConfig([typeEntry])))

    await act(async () => {
      result.current.handleCreateNoteImmediate('Project')
      await flushAsyncWork()
    })

    const tabContent = result.current.tabs[0].content
    expect(tabContent).toContain('## Custom Template')
  })

  it('handleUpdateFrontmatter does not call updateEntry for unknown keys', async () => {
    const { result } = renderHook(() => useNoteActions(makeConfig()))

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/note.md', 'custom_field', 'value')
    })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(setToastMessage).toHaveBeenCalledWith('Property updated')
  })
})
