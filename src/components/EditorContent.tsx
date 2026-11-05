import { currentSharedVaultId } from '../lib/sharing/sharedVaultLocation'
import { EditorContentLayout } from './editor-content/EditorContentLayout'
import { useEditorContentModel, type EditorContentProps } from './editor-content/useEditorContentModel'
import { SharedReadOnlyBanner } from './sharing/SharedReadOnlyBanner'

/** Constant for the page: only a vault shared with the user (TOL-237) can be read only for its role. */
const IN_SHARED_VAULT = currentSharedVaultId() !== null

export function EditorContent(props: EditorContentProps) {
  const model = useEditorContentModel(props)
  if (!IN_SHARED_VAULT || !model.path) return <EditorContentLayout {...model} />
  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0">
      <SharedReadOnlyBanner path={model.path} locale={model.locale} />
      <EditorContentLayout {...model} />
    </div>
  )
}
