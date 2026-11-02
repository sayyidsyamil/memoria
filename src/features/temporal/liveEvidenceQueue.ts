import { invoke } from '@tauri-apps/api/core'
import type { TranscriptDraft, TranscriptTurn } from '../meetings/meetingTypes'
import { withTimeout } from '../../lib/asyncTimeout'
import { checkLiveStatement, type LiveCue } from './liveAssistanceService'

const key = (turn: TranscriptTurn) => `${turn.start}:${turn.end}:${turn.text}`

/** Caller-owned serial checks. Only explicit finalization releases the last turn. */
export class LiveEvidenceQueue {
  private enabled = false
  private generation = 0
  private job: { id: string; promise: Promise<void> } | null = null
  private checked = new Set<string>()
  private attempts = new Map<string, number>()
  private warnings = new Set<string>()
  private cues: LiveCue[] = []
  private vaultPath: string
  private onUpdate: (cues: LiveCue[], notice: string) => void
  constructor(vaultPath: string, onUpdate: (cues: LiveCue[], notice: string) => void) {
    this.vaultPath = vaultPath; this.onUpdate = onUpdate
  }

  setEnabled(enabled: boolean) { this.enabled = enabled }
  async cancel() {
    this.generation++
    if (!this.job) return
    try { await invoke('cancel_wiki_memory', { jobId: this.job.id }) }
    catch (error) {
      this.warnings.add(`Live check cancellation could not be confirmed: ${String(error)}`)
      this.onUpdate(this.cues, [...this.warnings].join(' '))
      throw error
    }
  }
  private eligible(turn: TranscriptTurn) {
    return turn.text.trim() && !this.checked.has(key(turn)) && (this.attempts.get(key(turn)) ?? 0) < 2
  }
  private async check(turn: TranscriptTurn) {
    if (this.job || !this.enabled || !this.eligible(turn)) return
    const generation = this.generation
    const turnKey = key(turn)
    const id = crypto.randomUUID()
    this.attempts.set(turnKey, (this.attempts.get(turnKey) ?? 0) + 1)
    const promise = checkLiveStatement(this.vaultPath, turn.text, id).then(result => {
      if (generation !== this.generation || !this.enabled) return
      this.checked.add(turnKey)
      this.cues = [...result.cues, ...this.cues].filter((cue, index, all) => all.findIndex(item => item.factId === cue.factId && item.reason === cue.reason) === index).slice(0, 3)
      const notice = result.warnings.includes('No approved tracked facts')
        ? 'No approved tracked facts. Add and approve tracked items before using live checks.'
        : result.status === 'uncertain' ? 'A statement could not be verified. Inspect the transcript.' : ''
      if (notice) this.warnings.add(notice)
      this.onUpdate(this.cues, notice)
    }).catch(error => {
      if (generation !== this.generation || !this.enabled) return
      const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
      const notice = `Live evidence check failed: ${detail}. Recording continues.`
      this.warnings.add(notice); this.onUpdate(this.cues, notice)
    }).finally(() => { if (this.job?.id === id) this.job = null })
    this.job = { id, promise }
    await promise
  }
  async inspectEarlier(turns: TranscriptTurn[]) {
    if (this.job || !this.enabled) return
    const turn = turns.slice(0, -1).find(item => this.eligible(item))
    if (turn) await this.check(turn)
  }
  async finish(turns: TranscriptTurn[]): Promise<NonNullable<TranscriptDraft['liveChecks']>> {
    const previous = this.job
    await this.cancel()
    const generation = this.generation
    const finalTurns = turns.length ? [turns[turns.length - 1], ...turns.slice(0, -1)] : []
    const drain = (async () => {
      if (previous) await previous.promise
      for (const turn of finalTurns) {
        if (!this.enabled || generation !== this.generation) return
        // A cancelled provisional check may be retried during finalization.
        if (this.eligible(turn)) await this.check(turn)
      }
    })()
    try { await withTimeout(drain, 30000, 'Final evidence checks exceeded 30 seconds; unchecked turns remain for review.') }
    catch (error) {
      this.warnings.add(error instanceof Error ? error.message : String(error))
      await this.cancel()
    }
    const checkedTurns = turns.filter(turn => this.checked.has(key(turn))).length
    const uncheckedTurns = turns.length - checkedTurns
    if (uncheckedTurns) this.warnings.add(`${uncheckedTurns} transcript turn${uncheckedTurns === 1 ? ' was' : 's were'} not checked. Review the final transcript manually.`)
    const warnings = [...this.warnings]
    this.onUpdate(this.cues, warnings.join(' '))
    return { checkedTurns, uncheckedTurns, warnings }
  }
}
