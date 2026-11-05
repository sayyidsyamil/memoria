export function requireActiveSync(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('syncDeferred')
}
