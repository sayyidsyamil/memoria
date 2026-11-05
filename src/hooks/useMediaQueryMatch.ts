import { useEffect, useState } from 'react'

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

/** Whether `query` matches, following changes; always false when disabled. */
export function useMediaQueryMatch(query: string, enabled: boolean): boolean {
  const [matches, setMatches] = useState(() => mediaQueryList(query)?.matches ?? false)

  useEffect(() => {
    const media = mediaQueryList(query)
    if (!enabled || !media) return
    const update = () => { setMatches(media.matches) }
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [enabled, query])

  return enabled && matches
}
