import type { Tone } from '../components/memoriaUi'

const TONES: Tone[] = ['blue', 'orange', 'green', 'purple', 'teal', 'pink']

/** Distinct diarized speakers in order of first appearance; unknown voices are never numbered. */
export function speakerOrder(speakers: Iterable<string>): string[] {
  return [...new Set(speakers)].filter(speaker => speaker !== 'unassigned')
}

/** Speakers a reviewer has identified: diarized voices, plus the unknown voice once it has a name. */
export function identifiedSpeakers(speakers: Iterable<string>, names: Record<string, string> | undefined): string[] {
  return [...new Set(speakers)].filter(speaker => speaker !== 'unassigned' || !!names?.[speaker]?.trim())
}

export function speakerNumber(speaker: string, order: string[]): number {
  const digits = /^S?0*(\d+)$/i.exec(speaker)
  if (digits) return Number(digits[1])
  const index = order.indexOf(speaker)
  return index >= 0 ? index + 1 : order.length + 1
}

/** One label rule for live captions, review and the saved Markdown page. */
export function speakerLabel(speaker: string, names: Record<string, string> | undefined, order: string[]): string {
  const named = names?.[speaker]?.trim()
  if (named) return named
  return speaker === 'unassigned' ? 'Unknown speaker' : `Speaker ${speakerNumber(speaker, order)}`
}

export function speakerTone(speaker: string, order: string[]): Tone {
  return speaker === 'unassigned' ? 'neutral' : TONES[(speakerNumber(speaker, order) - 1) % TONES.length]
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
