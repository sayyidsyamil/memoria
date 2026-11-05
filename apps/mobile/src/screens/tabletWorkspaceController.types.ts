import type { MobileWorkspaceAction } from '../components/workspace/MobileWorkspaceActionSheet'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import type { ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'
import type { useTabletWorkspaceNavigation } from './tabletWorkspaceNavigation'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

export type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void

export type ReadOnlyFormUpdater = <Key extends keyof TabletReadOnlyForm>(key: Key, value: TabletReadOnlyForm[Key]) => void

export type SaveSelectedEdit = (toEdit: (noteId: string) => MobileWorkspaceEdit | null) => void

export type SetOpenAction = (action: MobileWorkspaceAction | null) => void

export type TabletWorkspaceNavigation = ReturnType<typeof useTabletWorkspaceNavigation>

export type WorkspaceActionsContext = {
  applyEdit: ApplyWorkspaceEdit
  closeAction: () => void
  navigation: TabletWorkspaceNavigation
  openAction: MobileWorkspaceAction | null
  readOnlyForm: TabletReadOnlyForm
  repositoryRequest?: ReadOnlyWorkspaceRequest
  selectedNote: MobileNote | null
  setOpenAction: SetOpenAction
  updateReadOnlyForm: ReadOnlyFormUpdater
  workspaceSnapshot: MobileWorkspaceSnapshot
}
