import { vi } from 'vitest'

export interface PhoneMediaStub {
  setMatches: (matches: boolean) => void
}

/** Stubs `window.matchMedia` with one query list whose match a test can flip. */
export function stubPhoneMedia(initial: boolean): PhoneMediaStub {
  const target = new EventTarget()
  const media = Object.assign(target, { matches: initial, media: '' })
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  return {
    setMatches: (matches) => {
      media.matches = matches
      target.dispatchEvent(new Event('change'))
    },
  }
}
