import type { GitProgressEvent } from 'isomorphic-git'
import { mobileText } from '../../i18n/mobileText'

type ProgressState = { progress?: GitProgressEvent | null; cancelling?: boolean; publishing?: boolean }
type ProgressLabel = { label: string; count: string | null; value?: { min: number; max: number; now: number } }
const phaseLabels: Record<string, Parameters<typeof mobileText>[0]> = {
  'Counting objects': 'mobile.vaults.cloneCounting',
  'Compressing objects': 'mobile.vaults.cloneCompressing',
  'Receiving objects': 'mobile.vaults.cloneReceiving',
  'Resolving deltas': 'mobile.vaults.cloneResolving',
  'Analyzing workdir': 'mobile.vaults.cloneAnalyzing',
  'Updating workdir': 'mobile.vaults.cloneWriting',
}

export function gitCloneProgressLabel(state: ProgressState): ProgressLabel {
  if (state.cancelling) return { label: mobileText('mobile.vaults.cloneCancelling'), count: null }
  if (state.publishing) return { label: mobileText('mobile.vaults.clonePublishing'), count: null }
  const label = mobileText(phaseLabels[state.progress?.phase ?? ''] ?? 'mobile.vaults.cloning')
  return { label, ...progressCount(state.progress) }
}

function progressCount(progress?: GitProgressEvent | null) {
  if (!progress) return { count: null }
  const loaded = Math.max(0, progress.loaded)
  if (!progress.total) return { count: loaded.toLocaleString('en') }
  const now = Math.min(loaded, progress.total)
  return {
    count: mobileText('mobile.vaults.cloneCount').replace('{loaded}', now.toLocaleString('en')).replace('{total}', progress.total.toLocaleString('en')),
    value: { min: 0, max: progress.total, now },
  }
}
