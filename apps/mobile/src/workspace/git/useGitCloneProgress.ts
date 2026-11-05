import { useEffect, useRef, useState } from 'react'
import type { GitProgressEvent } from 'isomorphic-git'

export type GitCloneControl = {
  signal: AbortSignal
  onProgress: (progress: GitProgressEvent) => void
  onPublish: () => void
}

export function useGitCloneProgress() {
  const active = useRef<AbortController | null>(null)
  const [progress] = useState(createProgressStore)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const publishStarted = useRef(false)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  const run = async <T>(task: (control: GitCloneControl) => Promise<T>): Promise<T> => {
    if (active.current) throw new Error('cloneInProgress')
    const controller = new AbortController()
    active.current = controller
    publishStarted.current = false
    setRunning(true)
    progress.publish(null)
    const publish = throttledProgress(progress.publish)
    try {
      return await task({ signal: controller.signal, onPublish: () => {
        publishStarted.current = true
        setPublishing(true)
      }, onProgress: event => {
        if (isCurrentClone(active.current, controller)) publish(event)
      } })
    } finally {
      if (active.current === controller) {
        active.current = null
        progress.publish(null)
        setRunning(false)
        setCancelling(false)
        setPublishing(false)
      }
    }
  }
  const cancel = () => {
    if (!active.current || publishStarted.current) return
    active.current.abort()
    setCancelling(true)
  }
  return { run, cancel, running, cancelling, publishing, progress }
}

function createProgressStore() {
  let value: GitProgressEvent | null = null
  const listeners = new Set<() => void>()
  return {
    snapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next: GitProgressEvent | null) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

function isCurrentClone(current: AbortController | null, controller: AbortController) {
  return current === controller && !controller.signal.aborted
}

function throttledProgress(publish: (progress: GitProgressEvent) => void) {
  let previousPhase: string | null = null
  let publishedAt = -Infinity
  return (event: GitProgressEvent) => {
    const now = performance.now()
    const complete = event.total !== undefined && event.loaded === event.total
    if (event.phase === previousPhase && !complete && now - publishedAt < 100) return
    previousPhase = event.phase
    publishedAt = now
    publish(event)
  }
}
