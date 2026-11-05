import { expect, it, vi } from 'vitest'
import { createMobileSentryTransport } from './mobileSentryTransport'
import type { Envelope } from '@sentry/core'

const envelope: Envelope = [{ event_id: 'test', sent_at: '2026-10-14T00:00:00Z' }, [[{ type: 'event' }, { exception: {} }]]]

it('sends nothing without activation and drops obsolete envelopes after opt-out/re-enable', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
  const gate = createMobileSentryTransport(fetcher)
  const old = gate.transport({ url: 'https://example.com/envelope', recordDroppedEvent: () => {} })
  await old.send(envelope)
  expect(fetcher).not.toHaveBeenCalled()
  gate.activate()
  await old.send(envelope)
  expect(fetcher).toHaveBeenCalledTimes(1)
  gate.abort()
  gate.activate()
  await old.send(envelope)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('aborts in-flight network requests immediately on withdrawal', async () => {
  let signal: AbortSignal | null | undefined
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    signal = init?.signal
    return new Promise<Response>(() => {})
  })
  const gate = createMobileSentryTransport(fetcher)
  gate.activate()
  const sender = gate.transport({ url: 'https://example.com/envelope', recordDroppedEvent: () => {} })
  void sender.send(envelope)
  expect(signal?.aborted).toBe(false)
  gate.abort()
  expect(signal?.aborted).toBe(true)
})
