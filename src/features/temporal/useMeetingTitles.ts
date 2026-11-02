import { useCallback, useEffect, useState } from 'react'
import { meetingService } from '../meetings/meetingService'
import type { MeetingTitles } from './temporalFormat'

const NO_TITLES: MeetingTitles = new Map()
const NO_DATES: ReadonlyMap<string, string> = new Map()

/**
 * Meeting titles for the evidence citations, and when each meeting took place, from the same meeting list the rest of the
 * app uses. Best effort: while it loads, or if it fails, citations simply fall back to a short labelled id.
 * Titles never outlive their vault, and a failed reload keeps the titles already known.
 */
export function useMeetingTitles(vaultPath: string): { titles: MeetingTitles; dates: ReadonlyMap<string, string>; reload: () => void } {
  const [loaded, setLoaded] = useState<{ vaultPath: string; titles: MeetingTitles; dates: ReadonlyMap<string, string> }>({ vaultPath, titles: NO_TITLES, dates: NO_DATES })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let canceled = false
    // Starting inside a promise turns a service that throws synchronously into an ordinary failure.
    Promise.resolve().then(() => meetingService.list(vaultPath)).then(records => {
      if (canceled || !Array.isArray(records)) return
      setLoaded({
        vaultPath,
        titles: new Map(records.flatMap(record => record?.id && record.title?.trim() ? [[record.id, record.title.trim()] as const] : [])),
        dates: new Map(records.flatMap(record => record?.id && typeof record.created === 'string' ? [[record.id, record.created] as const] : [])),
      })
    }).catch(() => undefined)
    return () => { canceled = true }
  }, [vaultPath, attempt])
  const reload = useCallback(() => setAttempt(value => value + 1), [])
  const current = loaded.vaultPath === vaultPath
  return { titles: current ? loaded.titles : NO_TITLES, dates: current ? loaded.dates : NO_DATES, reload }
}
