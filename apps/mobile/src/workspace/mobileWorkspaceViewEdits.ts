import type { MobileNoteWidth, MobileSavedView, MobileViewDefinition, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { createMobileSavedViewFilename, mobileSavedViewId, mobileSavedViewOrderUpdates, mobileSavedViewPath, moveMobileSavedView, nextMobileSavedViewOrder, orderedMobileSavedViews, serializeMobileSavedViewDefinition, type MobileViewMoveDirection } from './mobileSavedViews'
import { buildMobileSidebarSections } from './mobileSidebarSections'
import { mobileAllNotesFileVisibilityFromVaultConfig, mobileDefaultNoteWidthFromVaultConfig, mobileNoteListPropertyOverridesFromVaultConfig, mobileVaultConfigWithDefaultNoteWidth, mobileVaultConfigWithPrimaryNoteListProperties } from './mobileVaultConfig'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from './mobileWorkspaceEditing.types'
import { workspaceNotePool } from './mobileWorkspaceSnapshotEdits'

export function createMobileView(
  snapshot: MobileWorkspaceSnapshot,
  definition: MobileViewDefinition,
): MobileWorkspaceEditResult {
  const existingViews = snapshot.views ?? []
  const filename = createMobileSavedViewFilename(definition.name, existingViews.map((view) => view.filename))
  const view: MobileSavedView = {
    definition: {
      ...definition,
      order: nextMobileSavedViewOrder(existingViews),
    },
    filename,
    id: mobileSavedViewId(filename),
  }
  const views = mobileSavedViewOrderUpdates([...existingViews, view])
  const nextSnapshot = {
    ...snapshot,
    sidebarSections: buildMobileSidebarSections({
      allNotesFileVisibility: mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig),
      folderPaths: snapshot.folderPaths,
      notes: workspaceNotePool(snapshot),
      previousSections: snapshot.sidebarSections,
      typeDefinitions: snapshot.typeDefinitions,
      views,
    }),
    views,
  }

  return {
    snapshot: nextSnapshot,
    writes: views.map((savedView) => ({
      content: serializeMobileSavedViewDefinition(savedView.definition),
      kind: 'saveView',
      path: mobileSavedViewPath(savedView.filename),
    })),
  }
}

export function updateMobileView(
  snapshot: MobileWorkspaceSnapshot,
  viewId: string,
  definition: MobileViewDefinition,
): MobileWorkspaceEditResult {
  const existingView = findMobileView(snapshot.views, viewId)
  if (!existingView) return { snapshot, writes: [] }

  const view = { ...existingView, definition }
  const views = orderedMobileSavedViews((snapshot.views ?? []).map((candidate) => candidate.id === view.id ? view : candidate))

  return {
    snapshot: snapshotWithViews(snapshot, views),
    writes: [{
      content: serializeMobileSavedViewDefinition(definition),
      kind: 'saveView',
      path: mobileSavedViewPath(existingView.filename),
    }],
  }
}

export function deleteMobileView(
  snapshot: MobileWorkspaceSnapshot,
  viewId: string,
): MobileWorkspaceEditResult {
  const existingView = findMobileView(snapshot.views, viewId)
  if (!existingView) return { snapshot, writes: [] }

  const views = orderedMobileSavedViews((snapshot.views ?? []).filter((view) => view.id !== existingView.id))

  return {
    snapshot: snapshotWithViews(snapshot, views),
    writes: [{
      kind: 'deleteView',
      path: mobileSavedViewPath(existingView.filename),
    }],
  }
}

export function moveMobileView(
  snapshot: MobileWorkspaceSnapshot,
  viewId: string,
  direction: MobileViewMoveDirection,
): MobileWorkspaceEditResult {
  const views = moveMobileSavedView(snapshot.views ?? [], viewId, direction)
  if (!views) return { snapshot, writes: [] }

  const orderedViews = mobileSavedViewOrderUpdates(views)
  return {
    snapshot: snapshotWithViews(snapshot, orderedViews),
    writes: orderedViews.map((view) => ({
      content: serializeMobileSavedViewDefinition(view.definition),
      kind: 'saveView',
      path: mobileSavedViewPath(view.filename),
    })),
  }
}

export function updatePrimaryNoteListProperties(
  snapshot: MobileWorkspaceSnapshot,
  edit: Extract<MobileWorkspaceEdit, { type: 'updatePrimaryNoteListProperties' }>,
): MobileWorkspaceEditResult {
  const vaultConfig = mobileVaultConfigWithPrimaryNoteListProperties(
    snapshot.vaultConfig,
    edit.target,
    edit.listPropertiesDisplay,
    { allNotesFileVisibility: edit.allNotesFileVisibility },
  )

  return {
    snapshot: {
      ...snapshot,
      noteListPropertyOverrides: mobileNoteListPropertyOverridesFromVaultConfig(vaultConfig),
      vaultConfig,
    },
    writes: [{ config: vaultConfig, kind: 'saveVaultConfig' }],
  }
}

export function setDefaultNoteWidth(
  snapshot: MobileWorkspaceSnapshot,
  mode: MobileNoteWidth,
): MobileWorkspaceEditResult {
  const vaultConfig = mobileVaultConfigWithDefaultNoteWidth(snapshot.vaultConfig, mode)
  if (mobileDefaultNoteWidthFromVaultConfig(snapshot.vaultConfig) === vaultConfig.defaultNoteWidth) {
    return { snapshot, writes: [] }
  }

  return {
    snapshot: {
      ...snapshot,
      vaultConfig,
    },
    writes: [{ config: vaultConfig, kind: 'saveVaultConfig' }],
  }
}

export function findMobileView(views: MobileSavedView[] | undefined, viewId: string): MobileSavedView | null {
  return views?.find((view) => view.id === viewId || view.filename === viewId) ?? null
}

export function snapshotWithViews(
  snapshot: MobileWorkspaceSnapshot,
  views: MobileSavedView[],
): MobileWorkspaceSnapshot {
  return {
    ...snapshot,
    sidebarSections: buildMobileSidebarSections({
      allNotesFileVisibility: mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig),
      folderPaths: snapshot.folderPaths,
      notes: workspaceNotePool(snapshot),
      previousSections: snapshot.sidebarSections,
      typeDefinitions: snapshot.typeDefinitions,
      views,
    }),
    views,
  }
}
