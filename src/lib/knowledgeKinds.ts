import type { Tone } from '../components/memoriaUi'

/** One colour per knowledge type, shared by every surface that lists claims. */
const KIND_TONES: Record<string, Tone> = {
  Person: 'purple', Organization: 'pink', Project: 'teal', Topic: 'neutral', Decision: 'blue', Commitment: 'orange', Meeting: 'green',
}

export function kindTone(kind: string): Tone {
  return KIND_TONES[kind] ?? 'neutral'
}
