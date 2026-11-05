import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface WorkspaceSummary { meetings: number; approved: number; briefs: number; pendingReviews: number; sourceChanged: number }
export const MEMORY_CHANGED_EVENT = 'memoria-memory-changed'

/** One cheap call for sidebar counts; refreshes on saves, window focus and a slow timer. */
export function useWorkspaceSummary(vaultPath: string) {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null)
  const running = useRef(false)
  const refresh = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      const value = await invoke<WorkspaceSummary>('wiki_memory', { request: { action: 'summary', vaultPath } })
      if (value && typeof value.meetings === 'number') setSummary(value)
    } catch { /* counts are a convenience; the lists report their own errors */ }
    finally { running.current = false }
  }, [vaultPath])
  useEffect(() => {
    const update = () => { void refresh() }
    update()
    window.addEventListener(MEMORY_CHANGED_EVENT, update)
    window.addEventListener('focus', update)
    const timer = setInterval(update, 60000)
    return () => { window.removeEventListener(MEMORY_CHANGED_EVENT, update); window.removeEventListener('focus', update); clearInterval(timer) }
  }, [refresh])
  return { summary, refresh }
}

export function announceMemoryChanged() { window.dispatchEvent(new Event(MEMORY_CHANGED_EVENT)) }
