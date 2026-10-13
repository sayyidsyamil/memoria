import { useCallback, useEffect, useRef, useState } from 'react'
import { ledgerErrorMessage, type LedgerApi } from '../../lib/ledgerApi'
import type { LedgerData } from './ledgerContext'

interface LedgerDataState {
  data: LedgerData | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

async function loadAll(api: LedgerApi): Promise<LedgerData> {
  const registry = await api.getRegistry()
  const [facts, proposals, meetings] = await Promise.all([api.currentFacts(), api.listProposals(), api.listMeetings()])
  return { registry, facts, proposals, meetings }
}

export function useLedgerData(api: LedgerApi, enabled: boolean): LedgerDataState {
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++latest.current
    setLoading(true)
    try {
      const loaded = await loadAll(api)
      if (ticket !== latest.current) return
      setData(loaded)
      setError(null)
    } catch (e) {
      if (ticket === latest.current) setError(ledgerErrorMessage(e))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (enabled) void refresh()
    else latest.current += 1
  }, [enabled, refresh])

  return { data, loading, error, refresh }
}
