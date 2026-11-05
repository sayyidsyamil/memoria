// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors, WorkspaceSyncEditorsContext } from '../../workspace/workspaceSyncEditors'
import { mobileEditorDraftCommitDelayMs } from '../../workspace/mobileEditorDraft'
import { useMobileSourceEditorDraft } from './useMobileSourceEditorDraft'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.useRealTimers()
})

it('defers foreground sync without flushing, disabling or blurring a focused source input', async () => {
  const harness = createHarness()
  await harness.render()
  await harness.change('Typing a draft')
  await expect(harness.editors.prepare(true)).rejects.toThrow('editorSyncDeferred')
  expect(harness.commit).not.toHaveBeenCalled()
  expect(harness.result().paused).toBe(false)
  expect(harness.input.focus).not.toHaveBeenCalled()
  expect(harness.result().content).toBe('Typing a draft')
})

it.each([false, true])('flushes safely for manual sync or an unfocused automatic sync (%s)', async automatic => {
  const harness = createHarness()
  harness.input.isFocused.mockReturnValue(!automatic)
  await harness.render()
  await harness.change('Latest draft')
  const resume = await harness.prepare(automatic)
  expect(harness.commit).toHaveBeenCalledWith('new.md', 'Latest draft')
  expect(harness.result().paused).toBe(true)
  await harness.change('Ignored while paused')
  expect(harness.result().content).toBe('Latest draft')
  await act(async () => resume())
  expect(harness.result().paused).toBe(false)
})

it('keeps idle saves and unmount flushing without refocusing on save acknowledgements', async () => {
  vi.useFakeTimers()
  const harness = createHarness({ idleSave: true })
  await harness.render()
  await harness.change('Saved draft')
  await act(async () => vi.advanceTimersByTime(mobileEditorDraftCommitDelayMs))
  expect(harness.commit).toHaveBeenCalledWith('new.md', 'Saved draft')
  await harness.render('Saved draft')
  expect(harness.result().content).toBe('Saved draft')
  expect(harness.input.focus).not.toHaveBeenCalled()
  await harness.change('Final keystroke')
  await harness.unmount()
  expect(harness.commit).toHaveBeenLastCalledWith('new.md', 'Final keystroke')
})

it.each(['---\ntype: Note\n---\n# \n', '---\r\ntype: Note\r\n---\r\n\r\n# \r\n'])('focuses a newly created heading once, after frontmatter', async content => {
  const harness = createHarness()
  harness.editors.focus.request('new.md')
  await harness.render(content)
  expect(harness.input.focus).toHaveBeenCalledOnce()
  const caret = content.indexOf('# ') + 2
  expect(harness.input.setSelection).toHaveBeenCalledWith(caret, caret)
  expect(harness.editors.focus.has('new.md')).toBe(false)
  await harness.render(`${content}Body`)
  expect(harness.input.focus).toHaveBeenCalledOnce()
})

it('waits until the native input is mounted and the workspace is unblocked', async () => {
  vi.useFakeTimers()
  const harness = createHarness()
  harness.editors.focus.request('new.md')
  harness.inputRef.current = null
  harness.editors.setBlocked(true)
  await harness.render('# \n')
  await act(async () => vi.advanceTimersByTime(100))
  harness.inputRef.current = harness.input
  await act(async () => vi.advanceTimersByTime(100))
  expect(harness.input.focus).not.toHaveBeenCalled()
  harness.editors.setBlocked(false)
  await act(async () => vi.advanceTimersByTime(50))
  expect(harness.input.focus).toHaveBeenCalledOnce()
})

it('clears an unmounted source request so a later rich editor cannot steal focus', async () => {
  vi.useFakeTimers()
  const harness = createHarness()
  harness.editors.focus.request('new.md')
  harness.inputRef.current = null
  await harness.render()
  await harness.unmount()
  vi.runAllTimers()
  expect(harness.editors.focus.has('new.md')).toBe(false)
  expect(harness.input.focus).not.toHaveBeenCalled()
})

it('does not interpret a plain text file as Markdown or frontmatter', async () => {
  const harness = createHarness({ plainText: true })
  harness.editors.focus.request('new.md')
  await harness.render('---\ntype: literal\n---\n# literal')
  expect(harness.input.setSelection).toHaveBeenCalledWith(0, 0)
})

it('focuses a titleless body without rewriting it and uses the web selection API when available', async () => {
  const harness = createHarness()
  const setSelectionRange = vi.fn()
  Object.assign(harness.input, { setSelectionRange })
  harness.editors.focus.request('new.md')
  const content = '---\ntype: Note\n---\nBody without a title'
  await harness.render(content)
  const caret = content.indexOf('Body')
  expect(setSelectionRange).toHaveBeenCalledWith(caret, caret)
  expect(harness.input.setSelection).not.toHaveBeenCalled()
  expect(harness.result().content).toBe(content)
  expect(harness.commit).not.toHaveBeenCalled()
})

it('leaves the draft editable and dirty when its save cannot be queued', async () => {
  const harness = createHarness()
  await harness.render()
  await harness.change('Unsaved text')
  harness.commit.mockImplementation(() => { throw new Error('writeFailed') })
  await expect(harness.prepare(false)).rejects.toThrow('writeFailed')
  expect(harness.result().paused).toBe(false)
  expect(harness.result().content).toBe('Unsaved text')
  harness.commit.mockReset()
  await act(async () => harness.result().save())
  expect(harness.commit).toHaveBeenCalledWith('new.md', 'Unsaved text')
})

function createHarness(options: { idleSave?: boolean; plainText?: boolean } = {}) {
  const root = createRoot(document.createElement('div'))
  const editors = createWorkspaceSyncEditors()
  const input = { focus: vi.fn(), isFocused: vi.fn(() => true), setSelection: vi.fn() }
  const inputRef: { current: typeof input | null } = { current: input }
  const commit = vi.fn()
  let current: ReturnType<typeof useMobileSourceEditorDraft> | undefined
  let mounted = true
  function Probe({ content }: { content: string }) {
    const draft = useMobileSourceEditorDraft({
      inputRef, noteId: 'new.md', sourceContent: content, onCommit: commit, idleSave: false, ...options,
    })
    useEffect(() => { current = draft }, [draft])
    return null
  }
  const result = () => {
    if (!current) throw new Error('Source draft is not mounted')
    return current
  }
  const unmount = async () => {
    if (mounted) { mounted = false; await act(async () => root.unmount()) }
  }
  cleanups.push(unmount)
  return {
    commit, editors, input, inputRef, result, unmount,
    render: (content = 'Initial') => act(async () => {
      root.render(createElement(WorkspaceSyncEditorsContext.Provider, { value: editors }, createElement(Probe, { content })))
    }),
    change: (content: string) => act(async () => result().updateContent('new.md', content)),
    prepare: async (automatic: boolean) => {
      let resume = () => {}
      await act(async () => { resume = await editors.prepare(automatic) })
      return resume
    },
  }
}
