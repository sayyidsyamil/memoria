type DropChannel = 'dom' | 'native'
type DropClaim = { channel: DropChannel; filenames: string[] }
type RecentDrop = { channel: DropChannel; key: string; time: number }

/** Pair the two representations of one OS drop before either writes attachments. */
export function createImageDropClaim() {
  let recent: RecentDrop[] = []

  return {
    reset() { recent = [] },
    claim({ channel, filenames }: DropClaim): boolean {
      const time = performance.now()
      const key = JSON.stringify([...filenames].sort())
      recent = recent.filter(drop => time - drop.time < 1000)
      const counterpart = recent.findIndex(drop => drop.channel !== channel && drop.key === key)
      if (counterpart !== -1) {
        recent.splice(counterpart, 1)
        return false
      }
      recent.push({ channel, key, time })
      return true
    },
  }
}
