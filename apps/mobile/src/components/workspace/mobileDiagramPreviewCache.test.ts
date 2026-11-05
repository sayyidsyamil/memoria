import { beforeEach, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ copy: vi.fn(), mkdir: vi.fn(), remove: vi.fn(), write: vi.fn(), asset: vi.fn() }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'diagram-preview' }))
vi.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///application/Cache/',
  copyAsync: disk.copy, makeDirectoryAsync: disk.mkdir, deleteAsync: disk.remove, writeAsStringAsync: disk.write }))
vi.mock('./MobileWysiwygTentapEditorHtml', () => ({ mobileWysiwygTentapEditorHtml: '<html>shell</html>' }))
vi.mock('./mobileDiagramRendererAsset.native', () => ({ copyMobileDiagramRenderer: disk.asset }))

beforeEach(() => {
  vi.resetModules()
  for (const fn of Object.values(disk)) fn.mockReset().mockResolvedValue(undefined)
})

it('loads the offline renderer only for diagrams, once per private preview', async () => {
  const { createMobileEditorPreview } = await import('./mobileEditorFileSource.native')
  const preview = createMobileEditorPreview('file:///vault/')
  await preview.prepare('# Ordinary note')
  await preview.prepare('```tldraw\n{}\n```')
  expect(disk.asset).not.toHaveBeenCalled()
  await preview.prepare('```mermaid\ngraph TD; A-->B\n```')
  await preview.prepare('```tldraw\n{}\n```')
  expect(disk.asset).toHaveBeenCalledExactlyOnceWith(preview.rootUri)
  expect(disk.copy.mock.calls.every(([args]) => args.to.startsWith(preview.rootUri))).toBe(true)
  await preview.dispose()
})

it('keeps notes editable and retries when the optional renderer asset is unavailable', async () => {
  const { createMobileEditorPreview } = await import('./mobileEditorFileSource.native')
  const preview = createMobileEditorPreview('file:///vault/')
  disk.asset.mockRejectedValueOnce(new Error('cache full'))
  await expect(preview.prepare('```mermaid\ngraph TD; A-->B\n```')).resolves.toBeUndefined()
  await preview.prepare('```mermaid\ngraph TD; A-->B\n```')
  expect(disk.asset).toHaveBeenCalledTimes(2)
  await preview.dispose()
})

it('allows only the exact renderer as a subframe, never as a top-level or external navigation', async () => {
  const { createMobileEditorPreview, mobileEditorFileWebViewProps } = await import('./mobileEditorFileSource.native')
  const preview = createMobileEditorPreview('file:///vault/')
  const { onShouldStartLoadWithRequest: allow } = mobileEditorFileWebViewProps(preview)
  const url = `${preview.rootUri}diagram-renderer.html`
  expect(allow({ url, isTopFrame: false })).toBe(true)
  expect(allow({ url, isTopFrame: true })).toBe(false)
  expect(allow({ url })).toBe(false)
  expect(allow({ url: 'file:///vault/diagram-renderer.html', isTopFrame: false })).toBe(false)
})
