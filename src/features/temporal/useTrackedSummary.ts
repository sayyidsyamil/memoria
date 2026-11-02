import { useEffect, useState } from 'react'
import { MEMORY_CHANGED_EVENT } from '../../hooks/useWorkspaceSummary'
import { temporalService } from './temporalService'

/** How much the decision ledger holds: tracked items, approved values and suggestions waiting for approval. */
export interface TrackedSummary { items: number; facts: number; suggestions: number }

/**
 * The ledger's counts for the sidebar: the Decisions badge and whether the workspace holds decisions at all. Refreshed when
 * memory changes and when the window regains focus; a failed read keeps the last counts (the board reports its own errors).
 */
export function useTrackedSummary(vaultPath: string): TrackedSummary | null {
  const [loaded, setLoaded] = useState<{ vaultPath: string; summary: TrackedSummary } | null>(null)
  useEffect(() => {
    let canceled = false
    let running = false
    let again = false
    const update = () => {
      // A change during a read is read again afterwards, so the counts end up current.
      if (running) { again = true; return }
      running = true
      Promise.resolve().then(() => temporalService.overview(vaultPath)).then(overview => {
        if (canceled || !overview?.registry) return
        setLoaded({ vaultPath, summary: {
          items: overview.registry.objects?.length ?? 0, facts: overview.facts?.length ?? 0, suggestions: overview.proposals?.length ?? 0,
        } })
      }).catch(() => undefined).finally(() => {
        running = false
        if (again && !canceled) { again = false; update() }
      })
    }
    update()
    window.addEventListener(MEMORY_CHANGED_EVENT, update)
    window.addEventListener('focus', update)
    return () => { canceled = true; window.removeEventListener(MEMORY_CHANGED_EVENT, update); window.removeEventListener('focus', update) }
  }, [vaultPath])
  return loaded?.vaultPath === vaultPath ? loaded.summary : null
}
