import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Request, type TestInfo } from '@playwright/test'
import { originalPosition, type SourceMap } from './sourceMapLookup'

// TOL-232: web error telemetry. CI builds the bundle without a DSN, so the first test checks
// that nothing is sent even with crash reporting on, and that no source map is served.
// The second test runs when the bundle was built with MEMORIA_WEB_SENTRY_DSN pointing at a
// local fake ingest (see docs/web/telemetry.md): the envelope of a deliberate error carries
// the web tag, the commit release and frames that map back to src/main.tsx.

const WEB_DSN = process.env.MEMORIA_WEB_SENTRY_DSN ?? ''
const SOURCEMAP_DIR = fileURLToPath(new URL('../sourcemaps/', import.meta.url))
const MAIN_SOURCE = fileURLToPath(new URL('../../../src/main.tsx', import.meta.url))
const PROBE_COMMAND = 'tol232-sentry-probe'
const SENTRY_REQUEST = /sentry|\/envelope\//i

interface StackFrame {
  filename?: string
  lineno?: number
  colno?: number
}

interface SentryEvent {
  release?: string
  tags?: Record<string, string>
  exception?: { values?: { value?: string; stacktrace?: { frames?: StackFrame[] } }[] }
}

async function openAppWithCrashReporting(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => window.__laputaTest?.dispatchAppCommand('app-settings'))
  const settingsPanel = page.getByTestId('settings-panel')
  await expect(settingsPanel).toBeVisible({ timeout: 5_000 })
  await settingsPanel.getByTestId('settings-crash-reporting').locator('label').click()
  await page.getByTestId('settings-save').click()
  await expect(settingsPanel).not.toBeVisible({ timeout: 5_000 })
}

/** Throws from bundled code (main.tsx's test bridge), outside the caller, like a real bug. */
async function throwFromBundle(page: Page): Promise<void> {
  await page.evaluate((command) => {
    setTimeout(() => window.__laputaTest?.dispatchAppCommand(command), 0)
  }, PROBE_COMMAND)
}

function eventFromEnvelope(body: string): SentryEvent | null {
  const [, itemHeader, payload] = body.split('\n')
  if (!itemHeader || !payload) return null
  return JSON.parse(itemHeader).type === 'event' ? JSON.parse(payload) as SentryEvent : null
}

interface IngestLog {
  envelopes: number
  events: SentryEvent[]
}

function startFakeIngest(port: number, log: IngestLog): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      if (req.method === 'POST') log.envelopes += 1
      const event = req.method === 'POST' ? eventFromEnvelope(Buffer.concat(chunks).toString('utf8')) : null
      if (event) log.events.push(event)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', '*')
      res.end('{}')
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

/** Turns crash reporting on, throws the probe error and returns the event the fake ingest got. */
async function captureProbeEvent(page: Page): Promise<SentryEvent> {
  const log: IngestLog = { envelopes: 0, events: [] }
  const ingest = await startFakeIngest(Number(new URL(WEB_DSN).port), log)
  try {
    await openAppWithCrashReporting(page)
    // Sentry starts once the saved consent reaches the app; its session envelope says so.
    await expect.poll(() => log.envelopes, { timeout: 10_000 }).toBeGreaterThan(0)
    await throwFromBundle(page)
    await expect.poll(() => log.events.find(isProbeEvent), { timeout: 15_000 }).toBeTruthy()
  } finally {
    ingest.close()
  }
  return log.events.find(isProbeEvent) as SentryEvent
}

function isProbeEvent(event: SentryEvent): boolean {
  return event.exception?.values?.[0]?.value?.includes(PROBE_COMMAND) ?? false
}

interface MappedFrame {
  filename: string
  lineno: number
  colno: number
}

function isMappedFrame(frame: StackFrame): frame is MappedFrame {
  return Boolean(frame.filename?.includes('/assets/') && frame.lineno && frame.colno)
}

/** The innermost frame of the served bundle: the one that threw. */
function throwingFrame(event: SentryEvent): MappedFrame | undefined {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? []
  return frames.filter(isMappedFrame).at(-1)
}

/** The source position of the frame that threw, through the hidden source map of its file. */
function mappedThrowPosition(event: SentryEvent): ReturnType<typeof originalPosition> {
  const frame = throwingFrame(event)
  if (!frame) return null
  const file = new URL(frame.filename).pathname.slice(1)
  const map = JSON.parse(readFileSync(`${SOURCEMAP_DIR}${file}.map`, 'utf8')) as SourceMap
  return originalPosition(map, frame.lineno, frame.colno)
}

function probeThrowLine(): number {
  const lines = readFileSync(MAIN_SOURCE, 'utf8').split('\n')
  return lines.findIndex((line) => line.includes('throw new Error(`Unknown app command')) + 1
}

function skipOutsideChromium(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'chromium', 'one browser is enough for a build-level check')
}

test.describe('web error telemetry', () => {
  test('sends nothing without a DSN and serves no source maps', async ({ page, request }, testInfo) => {
    skipOutsideChromium(testInfo)
    test.skip(WEB_DSN !== '', 'the bundle was built with a test DSN')
    const sentryRequests: string[] = []
    page.on('request', (sent: Request) => {
      if (SENTRY_REQUEST.test(sent.url())) sentryRequests.push(sent.url())
    })

    await openAppWithCrashReporting(page)
    await throwFromBundle(page)
    await page.waitForTimeout(2_000)
    expect(sentryRequests).toEqual([])

    const entry = await page.evaluate(() => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '')
    const script = await request.get(entry)
    expect(await script.text()).not.toContain('sourceMappingURL')
    const map = await request.get(`${entry}.map`)
    expect(await map.text()).not.toContain('"mappings"')
  })

  test('sends a deliberate error with the web tag, release and a source-mapped stack', async ({ page }, testInfo) => {
    skipOutsideChromium(testInfo)
    test.skip(WEB_DSN === '', 'needs a bundle built with MEMORIA_WEB_SENTRY_DSN (docs/web/telemetry.md)')
    const event = await captureProbeEvent(page)
    const manifest = JSON.parse(readFileSync(`${SOURCEMAP_DIR}manifest.json`, 'utf8')) as { release: string }

    expect(event.tags?.platform).toBe('web')
    expect(manifest.release).toMatch(/^memoria-web@[0-9a-f]{40}$/)
    expect(event.release).toBe(manifest.release)
    expect(mappedThrowPosition(event)).toEqual({ source: expect.stringMatching(/src\/main\.tsx$/), line: probeThrowLine() })
  })
})
