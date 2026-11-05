import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitProgressEvent } from 'isomorphic-git'

export function useGitSyncProgress() {
  const generation = useRef(0)
  const [progress, setProgress] = useState<GitProgressEvent | null>(null)
  const clear = useCallback(() => setProgress(null), [])
  useEffect(() => () => { generation.current += 1 }, [])
  const run = async <T>(task: (report: (event: GitProgressEvent) => void) => Promise<T>) => {
    const current = ++generation.current
    let phase: string | undefined
    let publishedAt = -Infinity
    clear()
    try {
      return await task(event => {
        if (generation.current !== current) return
        const now = performance.now()
        const complete = event.total !== undefined && event.loaded === event.total
        if (phase === event.phase && !complete && now - publishedAt < 100) return
        phase = event.phase
        publishedAt = now
        setProgress(event)
      })
    } finally {
      if (generation.current === current) { generation.current += 1; clear() }
    }
  }
  return { progress, run, clear }
}
