function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local wall-clock time as ISO text without a timezone, so the meeting date never shifts. */
export function localWallClock(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** Gives a recorded transcript the Transcript type and a machine-readable date so the decision ledger can find it. */
export function withTranscriptNoteMetadata(markdown: string, now: Date = new Date()): string {
  if (markdown.startsWith('---\n')) return markdown
  return `---\ntype: Transcript\ndate: ${localWallClock(now)}\n---\n\n${markdown}`
}
