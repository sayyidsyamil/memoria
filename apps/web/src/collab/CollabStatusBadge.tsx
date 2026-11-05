import type * as Y from 'yjs'
import type { CollabProvider, CollabStatus } from '../../../../packages/collab-client/src/collabProvider'
import { SyncPill } from '../../../../src/components/SyncPill'
import { resolveSyncPillState } from '../../../../src/components/status-bar/syncPillState'
import { useCollabStatus, useConflictCopy } from '../../../../src/hooks/useCollabSyncState'
import { type AppLocale, type TranslationKey, translate } from '../../../../src/lib/i18n'

interface StatusProps {
  provider: CollabProvider
  locale: AppLocale
}

const STATUS_LABELS: Record<CollabStatus, TranslationKey> = {
  connecting: 'collab.status.connecting',
  syncing: 'collab.status.syncing',
  synced: 'collab.status.synced',
  offline: 'collab.status.offline',
  closed: 'collab.status.closed',
}

const NO_OTHER_STATE = { conflict: false, offline: false, reloading: false }

/** Connection and sync state of the note, announced to assistive technology when it changes. */
export function CollabStatusBadge({ provider, locale }: StatusProps) {
  const status = useCollabStatus(provider) ?? provider.status
  const label = translate(locale, STATUS_LABELS[status])
  return (
    <SyncPill
      state={resolveSyncPillState({ ...NO_OTHER_STATE, collab: status })}
      label={label}
      description={label}
      status={status}
      testId="collab-status"
      className="collab-status max-w-full whitespace-normal"
    />
  )
}

/** Tells the user where a change from elsewhere went when it could not be merged with their edits. */
export function ConflictNotice({ doc, locale }: { doc: Y.Doc; locale: AppLocale }) {
  const copy = useConflictCopy(doc)
  if (!copy) return null
  return (
    <p className="collab-conflict" role="alert" data-testid="collab-conflict">
      {translate(locale, 'collab.conflictCopy', { file: copy })}
    </p>
  )
}
