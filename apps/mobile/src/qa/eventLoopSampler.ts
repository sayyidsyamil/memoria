export const sampleIntervalMs = 16
const longDelayMs = 50
export type EventLoopMeasurement = {
  elapsedMs: number
  sampleCount: number
  longDelayCount: number
  maxDelayMs: number
}

export function createEventLoopSampler(started: number) {
  let previous = started
  let sampleCount = 0
  let longDelayCount = 0
  let maxDelayMs = 0
  const sample = (now: number) => {
    const delay = Math.max(0, now - previous - sampleIntervalMs)
    previous = now
    sampleCount += 1
    if (delay >= longDelayMs) longDelayCount += 1
    maxDelayMs = Math.max(maxDelayMs, delay)
  }
  return { sample, finish: (now: number): EventLoopMeasurement => {
    if (now - previous >= sampleIntervalMs) sample(now)
    return { elapsedMs: Math.round(now - started), sampleCount, longDelayCount, maxDelayMs: Math.ceil(maxDelayMs) }
  } }
}

export function createPhaseSampler() {
  const phases: (EventLoopMeasurement & { phase: string })[] = []
  let active: { phase: string; sampler: ReturnType<typeof createEventLoopSampler> } | undefined
  let closed = false
  const closeActive = (now: number) => {
    if (!active) return
    phases.push({ phase: active.phase, ...active.sampler.finish(now) })
    active = undefined
  }
  return {
    enter: (phase: string) => {
      if (closed) return
      const now = performance.now()
      closeActive(now)
      active = { phase, sampler: createEventLoopSampler(now) }
    },
    sample: (now: number) => active?.sampler.sample(now),
    finish: (now: number) => {
      closeActive(now)
      closed = true
      return phases
    },
  }
}
