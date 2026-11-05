// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MobileFilePreview } from './MobileFilePreview'
import type { MobileNote } from '../../workspace/mobileWorkspaceModel'

const platform = vi.hoisted(() => ({ OS: 'ios' }))
const capture = vi.hoisted(() => vi.fn())
vi.mock('../../analytics/useMobileAnalytics', () => ({ useMobileAnalytics: () => ({ capture }) }))
type PdfProps = {
  source: { uri: string }; onError: () => void; onContentProcessDidTerminate: () => void
  allowingReadAccessToURL: string; javaScriptEnabled: boolean; allowUniversalAccessFromFileURLs: boolean
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean; renderLoading: () => ReactNode
}
const pdfState = vi.hoisted(() => ({ props: null as PdfProps | null }))
vi.mock('react-native', async () => {
  const { createElement: element } = await import('react')
  const Container = ({ children, testID }: { children?: ReactNode; testID?: string }) =>
    element('div', { 'data-testid': testID }, children)
  const Image = ({ source, onError, onLoad }: { source: { uri: string }; onError: () => void; onLoad: () => void }) =>
    element('img', { src: source.uri, onError, onLoad })
  return { View: Container, ScrollView: Container, Image, ActivityIndicator: Container,
    StyleSheet: { create: (styles: object) => styles, absoluteFillObject: {} }, Platform: platform }
})
vi.mock('react-native-webview', async () => {
  const { createElement: element, useEffect } = await import('react')
  return { WebView: (props: PdfProps) => {
    useEffect(() => { pdfState.props = props }, [props])
    return element('button', { 'data-pdf': props.source.uri, onClick: props.onError }, props.renderLoading())
  } }
})
vi.mock('../../ui/theme/useMobileTheme', () => ({ useMobileColors: () => ({ editor: '#fff', textMuted: '#777' }) }))

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  platform.OS = 'ios'
  capture.mockClear()
})

it('records preview opening and decode failure without file identity', async () => {
  const preview = await renderPreview('private-image.png')
  expect(capture).toHaveBeenCalledWith({ name: 'file_preview_opened', preview_kind: 'image' })
  await preview.imageEvent('error')
  expect(capture).toHaveBeenLastCalledWith({ name: 'file_preview_failed', preview_kind: 'image' })
})

it('removes loading after an image loads, then displays fallback on a decode failure', async () => {
  const preview = await renderPreview('photo.png')
  expect(preview.container.querySelector('[data-testid="file-preview-loading"]')).not.toBeNull()
  await preview.imageEvent('load')
  expect(preview.container.querySelector('[data-testid="file-preview-loading"]')).toBeNull()
  await preview.imageEvent('error')
  expect(preview.container.textContent).toBe('Unavailable')
})

it('resets a failed image when switching notes and reads only the selected file', async () => {
  const preview = await renderPreview('broken.png')
  await preview.imageEvent('error')
  await preview.render('other.png')
  expect(preview.container.querySelector('img')?.getAttribute('src')).toBe('file:///vault/other.png')
  expect(preview.container.textContent).not.toContain('Unavailable')
})

it('keeps unsupported files out of the image renderer', async () => {
  const preview = await renderPreview('archive.zip')
  expect(preview.container.textContent).toBe('Unavailable')
  expect(preview.container.querySelector('img')).toBeNull()
})

it('renders iOS PDFs with an error fallback', async () => {
  const preview = await renderPreview('manual.pdf')
  const pdf = preview.container.querySelector<HTMLButtonElement>('[data-pdf]')
  expect(pdf?.dataset.pdf).toBe('file:///vault/manual.pdf')
  await act(async () => pdf?.click())
  expect(preview.container.textContent).toBe('Unavailable')
})

it('does not pretend Android WebView supports PDFs', async () => {
  platform.OS = 'android'
  const preview = await renderPreview('manual.pdf')
  expect(preview.container.textContent).toBe('Unavailable')
  expect(preview.container.querySelector('[data-pdf]')).toBeNull()
})

it('limits PDF reads and navigation to the selected file with JavaScript disabled', async () => {
  await renderPreview('manual.pdf')
  const props = pdfState.props
  expect(props?.allowingReadAccessToURL).toBe('file:///vault/manual.pdf')
  expect(props?.javaScriptEnabled).toBe(false)
  expect(props?.allowUniversalAccessFromFileURLs).toBe(false)
  expect(props?.onShouldStartLoadWithRequest({ url: 'file:///vault/manual.pdf' })).toBe(true)
  expect(props?.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true)
  for (const url of ['https://example.com', 'file:///vault/other.pdf']) {
    expect(props?.onShouldStartLoadWithRequest({ url })).toBe(false)
  }
})

it('recovers from a terminated PDF process when another file is opened', async () => {
  const preview = await renderPreview('manual.pdf')
  await act(async () => pdfState.props?.onContentProcessDidTerminate())
  expect(preview.container.textContent).toBe('Unavailable')
  await preview.render('second.pdf')
  expect(preview.container.querySelector('[data-pdf]')?.getAttribute('data-pdf')).toBe('file:///vault/second.pdf')
})

async function renderPreview(path: string) {
  const container = document.createElement('div')
  const root = createRoot(container)
  cleanups.push(async () => { await act(async () => root.unmount()) })
  const render = async (id: string) => {
    const note: MobileNote = { id, title: id, fileKind: 'binary', created: '', date: '', favorite: false,
      links: 0, modified: '', relationships: [], status: '', snippet: '', tags: [], type: 'File', typeTone: 'gray', workspace: '' }
    await act(async () => root.render(createElement(MobileFilePreview, { note, vaultRootUri: 'file:///vault/', fallback: 'Unavailable' })))
  }
  await render(path)
  return { container, render, imageEvent: async (event: string) => {
    await act(async () => container.querySelector('img')?.dispatchEvent(new Event(event)))
  } }
}
