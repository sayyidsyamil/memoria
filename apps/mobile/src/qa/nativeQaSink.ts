type NativeQaSender = (event: unknown) => void
let layoutSender: NativeQaSender | null = null

export function setNativeQaSinkUrl(value: string | null) {
  layoutSender = createNativeQaSender(value)
}

function localCollectorUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null
    if (url.username || url.password || url.hash) return null
    return value
  } catch { return null }
}

export function postNativeQaEvent(event: unknown) {
  layoutSender?.(event)
}

/** Async proofs retain their authorized collector independently of layout lifecycle. */
export function createNativeQaSender(value: string | null): NativeQaSender | null {
  const destination = localCollectorUrl(value)
  if (!destination) return null
  return event => {
    void fetch(destination, {
      body: JSON.stringify(event),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
    }).catch(() => undefined)
  }
}

export function logNativeQaProof(line: string) {
  console.info(line)
  postNativeQaEvent({ proofLog: line })
}

const proofPrefixes = [
  'MEMORIA_MOBILE_WYSIWYG_MUTATION_PROBE ',
  'MEMORIA_MOBILE_WYSIWYG_PERSISTENCE_PROBE ',
]

export function nativeQaSinkLogLine(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null
  if ('proofLog' in event) return acceptedProofLine(event.proofLog)
  if (!validMetric(event)) return null
  return `MEMORIA_MOBILE_LAYOUT_METRIC ${JSON.stringify(event)}`
}

function acceptedProofLine(line: unknown): string | null {
  if (typeof line !== 'string' || line.includes('\n') || line.length > 64_000) return null
  return proofPrefixes.some((prefix) => line.startsWith(prefix)) ? line : null
}

function validMetric(event: object): boolean {
  const metric = event as Record<string, unknown>
  return typeof metric.id === 'string' && typeof metric.platform === 'string'
    && ['x', 'y', 'width', 'height'].every((key) => typeof metric[key] === 'number' && Number.isFinite(metric[key]))
}
