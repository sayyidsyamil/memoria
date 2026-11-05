export const PREPARATION_STEPS = ['Microphone', 'Speech model', 'Live captions']
export const COMPACT_BARS = 20

export function clockText(total: number) {
  const hours = Math.floor(total / 3600)
  const rest = `${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return hours ? `${hours}:${rest}` : rest
}
