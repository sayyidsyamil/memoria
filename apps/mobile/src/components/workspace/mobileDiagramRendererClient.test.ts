// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MobileDiagramRendererClient } from './mobileDiagramRendererClient.web'

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('waits for its opaque renderer, rejects other windows, and resolves only matching responses', async () => {
  const port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null }
  const secondPort = { close: vi.fn() }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = secondPort })
  const client = new MobileDiagramRendererClient()
  const result = client.render({ kind: 'mermaid', content: 'graph TD; A-->B', dark: false })
  const frame = document.querySelector('iframe')
  if (!frame?.contentWindow) throw new Error('Renderer iframe missing')
  const send = vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => undefined)
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.tabIndex).toBe(-1)
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'memoria-diagram-ready' } }))
  expect(send).not.toHaveBeenCalled()
  frame.dispatchEvent(new Event('load'))
  expect(send).toHaveBeenCalledWith({ type: 'memoria-diagram-connect' }, { targetOrigin: '*', transfer: [secondPort] })
  expect(port.postMessage).not.toHaveBeenCalled()
  port.onmessage?.(new MessageEvent('message', { data: { type: 'memoria-diagram-ready' } }))
  expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'memoria-diagram-render', id: 1 }))
  port.onmessage?.(new MessageEvent('message', { data: { type: 'memoria-diagram-result', id: 1, svg: '<svg/>' } }))
  await expect(result).resolves.toBe('<svg/>')
  client.dispose()
  expect(document.querySelector('iframe')).toBeNull()
  expect(port.close).toHaveBeenCalledOnce()
})

it('falls back on timeouts and cancels outstanding work when its editor unmounts', async () => {
  vi.useFakeTimers()
  const client = new MobileDiagramRendererClient()
  const timedOut = client.render({ kind: 'tldraw', content: '{}', dark: true })
  const assertion = expect(timedOut).rejects.toThrow('unavailable')
  await vi.advanceTimersByTimeAsync(30_000)
  await assertion
  const disposed = client.render({ kind: 'tldraw', content: '{}', dark: true })
  const disposedAssertion = expect(disposed).rejects.toThrow('disposed')
  client.dispose()
  await disposedAssertion
})
