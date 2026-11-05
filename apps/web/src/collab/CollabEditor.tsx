import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { RemoteBindings } from '../../../../packages/collab-client/src/remoteVaultBackend'
import { schema } from '../../../../src/components/editorSchema'
import { useDocumentThemeMode } from '../../../../src/hooks/useDocumentThemeMode'
import type { VaultCollabDoc, VaultCollabUser } from '../../../../src/lib/vaultBackend/types'

interface CollabEditorProps {
  document: VaultCollabDoc<RemoteBindings>
  user: VaultCollabUser
}

/**
 * The Memoria editor bound to a live document instead of a markdown string: BlockNote's
 * collaboration edits the shared fragment and draws the other cursors and selections.
 */
export function CollabEditor({ document, user }: CollabEditorProps) {
  const editor = useCreateBlockNote({
    schema,
    collaboration: { fragment: document.fragment, provider: document.provider, user, showCursorLabels: 'activity' },
  })
  const theme = useDocumentThemeMode()
  return <BlockNoteView editor={editor} theme={theme} className="collab-editor" data-testid="collab-editor" />
}
