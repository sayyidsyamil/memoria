// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ copy: vi.fn(), mkdir: vi.fn(), remove: vi.fn(), write: vi.fn(), sequence: 0 }))
vi.mock('expo-crypto', () => ({ randomUUID: () => `preview-${++disk.sequence}` }))
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', copyAsync: disk.copy, makeDirectoryAsync: disk.mkdir,
  deleteAsync: disk.remove, writeAsStringAsync: disk.write,
}))
vi.mock('./MobileWysiwygTentapEditorHtml', () => ({ mobileWysiwygTentapEditorHtml: '<html>editor</html>' }))

const cleanups: (() => Promise<void>)[] = []
beforeEach(() => {
  vi.resetModules()
  for (const fn of [disk.copy, disk.mkdir, disk.remove, disk.write]) fn.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

it('uses the inline editor immediately when there is no local vault', async () => {
  const editor = await createHarness()
  await editor.render(null, '# Note')
  expect(editor.result().ready).toBe(true)
  expect(editor.result().webViewProps).toEqual({})
  expect(disk.write).not.toHaveBeenCalled()
})

it('keeps the same WebView source across autosaves and stages a newly imported image', async () => {
  const editor = await createHarness()
  await editor.render('file:///vault/', '# Title')
  const source = editor.result().webViewProps.source
  expect(source).toBeDefined()
  await editor.render('file:///vault/', '# Title\nBody after autosave')
  expect(editor.result().webViewProps.source).toBe(source)
  await editor.result().prepareAttachment?.('attachments/new.png')
  expect(disk.copy).toHaveBeenLastCalledWith({
    from: 'file:///vault/attachments/new.png',
    to: `${editor.result().webViewProps.allowingReadAccessToURL}attachments/new.png`,
  })
})

it('does not replace the inline fallback and steal focus when cache access recovers during typing', async () => {
  disk.copy.mockRejectedValueOnce(new Error('cache unavailable'))
  const editor = await createHarness()
  await editor.render('file:///vault/', '# Title')
  expect(editor.result().ready).toBe(true)
  expect(editor.result().webViewProps).toEqual({})
  await editor.render('file:///vault/', '# Title\nStill typing')
  expect(editor.result().webViewProps).toEqual({})
  expect(disk.copy).toHaveBeenCalledOnce()
})

it('gives a switched vault a separate scope and deletes only the previous preview', async () => {
  const editor = await createHarness()
  await editor.render('file:///first-vault/', '# First')
  const first = editor.result().webViewProps.allowingReadAccessToURL
  await editor.render('file:///second-vault/', '# Second')
  expect(editor.result().webViewProps.allowingReadAccessToURL).not.toBe(first)
  expect(disk.remove).toHaveBeenLastCalledWith(first, { idempotent: true })
})

async function createHarness() {
  const { act, createElement, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useMobileEditorFileSource } = await import('./mobileEditorFileSource.native')
  const root = createRoot(document.createElement('div'))
  let state: ReturnType<typeof useMobileEditorFileSource> | undefined
  function Probe({ vault, markdown }: { vault: string | null; markdown: string }) {
    const current = useMobileEditorFileSource(vault, markdown)
    useEffect(() => { state = current }, [current])
    return null
  }
  cleanups.push(async () => { await act(async () => root.unmount()) })
  return {
    render: async (vault: string | null, markdown: string) => {
      await act(async () => root.render(createElement(Probe, { vault, markdown })))
    },
    result: () => {
      if (!state) throw new Error('Editor not rendered')
      return state
    },
  }
}
