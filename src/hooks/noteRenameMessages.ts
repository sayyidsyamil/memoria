import { vaultRelativePathLabel } from '../utils/notePathIdentity'

/** Toast text for renames and moves, with how many linked notes were rewritten. */

function rewriteSummaryLabel(params: { updatedFiles: number }): string {
  return params.updatedFiles === 1 ? 'Updated 1 note' : `Updated ${params.updatedFiles} notes`
}

function manualUpdateWarning(params: { failedUpdates: number }): string {
  const { failedUpdates } = params
  return `${failedUpdates} linked note${failedUpdates > 1 ? 's' : ''} need${failedUpdates === 1 ? 's' : ''} manual updates`
}

function formatRewriteToast(params: {
    action: string
    updatedFiles: number
    failedUpdates?: number
    preferBareUpdate?: boolean
}): string {
  const { action, updatedFiles, failedUpdates = 0, preferBareUpdate = false } = params
  if (failedUpdates > 0) {
    if (updatedFiles === 0) {
      return `${action}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    if (preferBareUpdate) {
      return `${rewriteSummaryLabel({ updatedFiles })}, but ${manualUpdateWarning({ failedUpdates })}`
    }
    return `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}, but ${manualUpdateWarning({ failedUpdates })}`
  }
  if (updatedFiles === 0) return action
  return preferBareUpdate
    ? rewriteSummaryLabel({ updatedFiles })
    : `${action} and ${rewriteSummaryLabel({ updatedFiles }).toLowerCase()}`
}

export function renameToastMessage(updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: 'Renamed',
    updatedFiles,
    failedUpdates,
    preferBareUpdate: true,
  })
}

function folderLabel(params: { folderPath: string }): string {
  return vaultRelativePathLabel(params.folderPath)
}

export function moveToastMessage(folderPath: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${folderLabel({ folderPath })}"`,
    updatedFiles,
    failedUpdates,
  })
}

export function moveWorkspaceToastMessage(workspaceLabel: string, updatedFiles: number, failedUpdates = 0): string {
  return formatRewriteToast({
    action: `Moved to "${workspaceLabel}"`,
    updatedFiles,
    failedUpdates,
  })
}

const USER_FACING_RENAME_ERRORS = new Set(['A note with that name already exists', 'Invalid filename'])

function trimmedErrorText(err: unknown): string {
  if (typeof err === 'string') return err.trim()
  return err instanceof Error ? err.message.trim() : ''
}

export function renameErrorMessage(err: unknown): string {
  const message = trimmedErrorText(err)
  return USER_FACING_RENAME_ERRORS.has(message) ? message : 'Failed to rename note'
}

export function moveNoteErrorMessage(err: unknown): string {
  return trimmedErrorText(err) || 'Failed to move note'
}
