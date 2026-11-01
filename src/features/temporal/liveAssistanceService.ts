import { invoke } from '@tauri-apps/api/core'

export interface LiveCue {
  factId: number; label: string; attribute: string; currentValue: unknown
  quote: string; speaker?: string; meeting?: string; at?: number; reason: string
}
export interface LiveCheck { status: 'quiet' | 'attention' | 'uncertain'; cues: LiveCue[]; warnings: string[]; seconds: number }
export async function checkLiveStatement(vaultPath: string, statement: string, jobId: string): Promise<LiveCheck> {
  return invoke('live_memory_check', { vaultPath, statement, jobId })
}
