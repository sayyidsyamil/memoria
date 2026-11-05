import { vi } from 'vitest'

export interface MediaQueriesStub {
  set: (query: string, matches: boolean) => void
}

/** Stubs `window.matchMedia` with one list per query; queries not set do not match. */
export function stubMediaQueries(initial: Record<string, boolean>): MediaQueriesStub {
  const lists = new Map<string, EventTarget & { matches: boolean; media: string }>()
  const initialMatches = new Map(Object.entries(initial))
  const list = (query: string) => {
    let media = lists.get(query)
    if (!media) {
      media = Object.assign(new EventTarget(), { matches: initialMatches.get(query) ?? false, media: query })
      lists.set(query, media)
    }
    return media
  }
  vi.stubGlobal('matchMedia', vi.fn(list))
  return {
    set: (query, matches) => {
      const media = list(query)
      media.matches = matches
      media.dispatchEvent(new Event('change'))
    },
  }
}
