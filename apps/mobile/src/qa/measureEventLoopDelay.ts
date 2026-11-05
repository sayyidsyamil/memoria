import { createEventLoopSampler, createPhaseSampler, sampleIntervalMs } from './eventLoopSampler'

/** Measures JavaScript scheduling delay, not native animation frame rate. */
export async function measureEventLoopDelay<T>(operation: (enterPhase: (phase: string) => void) => Promise<T>) {
  const started = performance.now()
  const aggregate = createEventLoopSampler(started)
  const phaseSampler = createPhaseSampler()
  const timer = setInterval(() => {
    const now = performance.now()
    aggregate.sample(now)
    phaseSampler.sample(now)
  }, sampleIntervalMs)
  try {
    const result = await operation(phaseSampler.enter)
    const finished = performance.now()
    const phases = phaseSampler.finish(finished)
    return { result, eventLoop: aggregate.finish(finished), ...(phases.length ? { phases } : {}) }
  } finally {
    clearInterval(timer)
    phaseSampler.finish(performance.now())
  }
}
