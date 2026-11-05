import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { MobileAnalyticsEvent } from './mobileAnalytics'

export function trackSuccessfulMobileEdit(edit: MobileWorkspaceEdit, writes: number, capture: (event: MobileAnalyticsEvent) => void) {
  if (writes === 0) return
  try { captureEdit(edit, capture) } catch { /* Telemetry cannot invalidate a persisted edit. */ }
}

function captureEdit(edit: MobileWorkspaceEdit, capture: (event: MobileAnalyticsEvent) => void) {
  if (edit.type === 'createNote' || edit.type === 'createRelationshipTarget') capture({ name: 'note_created' })
  if (edit.type === 'deleteNote') capture({ name: 'note_deleted' })
}
