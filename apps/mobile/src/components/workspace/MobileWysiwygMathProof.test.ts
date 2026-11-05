import { afterEach, expect, it, vi } from 'vitest'
import { MobileMathInlineBridge } from './MobileWysiwygMathBridge'
import { renderMobileInlineMathHtml } from './MobileWysiwygMathHtml'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('correlates concurrent render proofs independently of random values and response order', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const send = vi.fn()
  const editor = MobileMathInlineBridge.extendEditorInstance(send)
  const inline = editor.getMathInlineRenderProof()
  const block = editor.getMathBlockRenderProof()
  const [inlineRequest, blockRequest] = send.mock.calls.map(([message]) => message)

  expect(inlineRequest.payload.messageId).not.toBe(blockRequest.payload.messageId)
  MobileMathInlineBridge.onEditorMessage({
    type: 'send-math-render-proof', payload: { messageId: blockRequest.payload.messageId, rendered: true },
  })
  MobileMathInlineBridge.onEditorMessage({
    type: 'send-math-render-proof', payload: { messageId: inlineRequest.payload.messageId, rendered: false },
  })
  await expect(block).resolves.toBe(true)
  await expect(inline).resolves.toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('times out an unanswered proof without affecting another request', async () => {
  vi.useFakeTimers()
  const send = vi.fn()
  const editor = MobileMathInlineBridge.extendEditorInstance(send)
  const unanswered = editor.getMathInlineRenderProof()
  const answered = editor.getMathBlockRenderProof()
  const request = send.mock.calls[1]?.[0]
  expect(request).toBeDefined()
  MobileMathInlineBridge.onEditorMessage({
    type: 'send-math-render-proof', payload: { messageId: request.payload.messageId, rendered: true },
  })

  await expect(answered).resolves.toBe(true)
  await vi.runAllTimersAsync()
  await expect(unanswered).resolves.toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  String.raw`\text{<img src=x onerror=alert(1)>}`,
  String.raw`\href{javascript:alert(1)}{unsafe}`,
  String.raw`\htmlClass{unsafe}{<script>alert(1)</script>}`,
])('does not emit executable HTML for untrusted math %s', (latex) => {
  const html = renderMobileInlineMathHtml(latex)
  expect(html).not.toMatch(/<(?:script|img|iframe|svg)\b/i)
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:javascript|data):/i)
})
