import { useEffect, useState } from 'react'
import type { HistoryEntry } from '../../lib/ledgerApi'
import { useLedger } from './ledgerContext'

/** Loads a value's history. With `enabled` false nothing is fetched. */
export function useFactHistory(objectId: string, attribute: string, enabled = true) {
  const { api } = useLedger()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    api.factHistory(objectId, attribute).then((h) => { if (!cancelled) setEntries(h) }, (e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api, objectId, attribute, enabled])
  return { entries, error }
}
