import { useEffect } from 'react'
import { markStartupPhase } from '../lib/startupPerformance'

/**
 * Marks `note_list_painted` once the note list has rows on screen, after the browser painted
 * them. The web keeps the editor bundle behind this mark (TOL-206).
 */
export function useNoteListPaintedMark(hasRows: boolean): void {
  useEffect(() => {
    if (!hasRows) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => { markStartupPhase('note_list_painted') }, 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [hasRows])
}
