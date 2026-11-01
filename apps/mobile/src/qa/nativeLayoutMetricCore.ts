
export type NativeLayoutMetric = {
  height: number
  id: string
  platform: string
  width: number
  x: number
  y: number
}

export type NativeLayoutMetricMap = Record<string, NativeLayoutMetric>

export type NativeLayoutAssertionFailure = {
  actual: number | null
  expected: number
  id: string
  message: string
}

type LayoutExpectation = {
  actual: number | null
  expected: number
  id: string
  message: string
}

type MetricExpectation = {
  id: string
  message: string
  metric: NativeLayoutMetric | undefined
}

const metricPrefix = 'MEMORIA_MOBILE_LAYOUT_METRIC'

const layoutTolerance = 1.5

type StackedMetricSequence = {
  currentMessage: string
  ids: readonly string[]
  metricId: (id: string) => string
  previousMessage: string
  stackingMessage: string
}

export function assertExactMetricStack(
  metrics: NativeLayoutMetricMap,
  sequence: StackedMetricSequence,
): NativeLayoutAssertionFailure[] {
  return sequence.ids.slice(1).flatMap((id, index) => {
    const previousId = sequence.ids[index]
    const previous = metrics[sequence.metricId(previousId)]
    const current = metrics[sequence.metricId(id)]

    return [
      ...expectMetric({ id: previousId, message: sequence.previousMessage, metric: previous }),
      ...expectMetric({ id, message: sequence.currentMessage, metric: current }),
      ...expectClose({
        actual: previous && current ? current.y - previous.y - previous.height : null,
        expected: 0,
        id,
        message: sequence.stackingMessage,
      }),
    ]
  })
}

export function parseNativeLayoutMetrics(logText: string): NativeLayoutMetric[] {
  const metrics: NativeLayoutMetric[] = []

  for (const line of logText.split('\n')) {
    const prefixIndex = line.indexOf(metricPrefix)
    if (prefixIndex === -1) continue

    const rawJson = line.slice(prefixIndex + metricPrefix.length).trim()
    const metric = parseMetric(rawJson)
    if (metric) metrics.push(metric)
  }

  return metrics
}

export function latestNativeLayoutMetrics(metrics: NativeLayoutMetric[]): NativeLayoutMetricMap {
  return Object.fromEntries(metrics.map((metric) => [metric.id, metric]))
}

export function formatNativeLayoutAssertionFailures(failures: NativeLayoutAssertionFailure[]) {
  return failures
    .map((failure) => {
      const actual = failure.actual === null ? 'missing' : failure.actual.toFixed(1)
      return `${failure.id}: ${failure.message}; expected ${failure.expected.toFixed(1)}, got ${actual}`
    })
    .join('\n')
}

export function expectMetric(expectation: MetricExpectation): NativeLayoutAssertionFailure[] {
  const { id, message, metric } = expectation
  if (metric) return []

  return [{ actual: null, expected: 1, id, message }]
}

export function expectClose(expectation: LayoutExpectation): NativeLayoutAssertionFailure[] {
  const { actual, expected, id, message } = expectation
  if (actual !== null && Math.abs(actual - expected) <= layoutTolerance) return []

  return [{ actual, expected, id, message }]
}

export function expectAtLeast(expectation: LayoutExpectation & { roundingTolerance?: number }): NativeLayoutAssertionFailure[] {
  const { actual, expected, id, message } = expectation
  if (actual !== null && actual >= expected - (expectation.roundingTolerance ?? 0)) return []

  return [{ actual, expected, id, message }]
}

export function expectAtMost(expectation: LayoutExpectation): NativeLayoutAssertionFailure[] {
  const { actual, expected, id, message } = expectation
  if (actual !== null && actual <= expected) return []

  return [{ actual, expected, id, message }]
}

function parseMetric(rawJson: string): NativeLayoutMetric | null {
  try {
    const value: unknown = JSON.parse(rawJson)
    return nativeLayoutMetricFromJson(value)
  } catch {
    return null
  }
}

function nativeLayoutMetricFromJson(value: unknown): NativeLayoutMetric | null {
  if (!isRecord(value)) return null

  const id = stringValue(value.id)
  const platform = stringValue(value.platform)
  const height = numberValue(value.height)
  const width = numberValue(value.width)
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  if (!id || !platform || height === null || width === null || x === null || y === null) return null

  return { height, id, platform, width, x, y }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
