import { useEffect, useMemo, useState } from 'react'
import { createRemoteVaultBackend, type RemoteBindings } from '../../../../packages/collab-client/src/remoteVaultBackend'
import type { AppLocale } from '../../../../src/lib/i18n'
import { translate } from '../../../../src/lib/i18n'
import type { VaultCollabDoc } from '../../../../src/lib/vaultBackend/types'
import { CollabEditor } from './CollabEditor'
import { CollabStatusBadge, ConflictNotice } from './CollabStatusBadge'
import { PresenceAvatars } from './PresenceAvatars'
import type { CollabSession } from './session'

interface CollabNoteProps {
  session: CollabSession
  locale: AppLocale
}

type Opened = { document: VaultCollabDoc<RemoteBindings>; ready: boolean } | { failed: true } | null

/** Opens the session's note through the `VaultBackend` seam and leaves it on unmount. */
function useCollabDocument({ token, name, color, note }: CollabSession): Opened {
  const backend = useMemo(() => createRemoteVaultBackend({ baseUrl: '', token }), [token])
  const [opened, setOpened] = useState<Opened>(null)

  useEffect(() => {
    let left = false
    let current: VaultCollabDoc<RemoteBindings> | null = null
    backend.collab
      ?.openDoc(note, { user: { name, color } })
      .then((document) => {
        if (left) return document.close()
        current = document
        setOpened({ document, ready: false })
        return document.synced.then(() => left || setOpened({ document, ready: true }))
      })
      .catch(() => left || setOpened({ failed: true }))
    return () => {
      left = true
      current?.close()
    }
  }, [backend, note, name, color])

  return opened
}

export function CollabNote({ session, locale }: CollabNoteProps) {
  const opened = useCollabDocument(session)
  if (opened && 'failed' in opened) {
    return (
      <p className="collab-conflict" role="alert" data-testid="collab-error">
        {translate(locale, 'collab.error.open')}
      </p>
    )
  }
  return (
    <div className="collab-note">
      <header className="collab-note__header">
        <span className="collab-note__path" data-testid="collab-note-path">
          {session.note}
        </span>
        {opened && <PresenceAvatars awareness={opened.document.awareness} locale={locale} />}
        {opened && <CollabStatusBadge provider={opened.document.provider} locale={locale} />}
      </header>
      {opened && <ConflictNotice doc={opened.document.doc} locale={locale} />}
      <main className="collab-note__body editor-content">
        {opened?.ready && <CollabEditor document={opened.document} user={{ name: session.name, color: session.color }} />}
      </main>
    </div>
  )
}
