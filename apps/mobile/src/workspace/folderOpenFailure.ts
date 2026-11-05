export type FolderOpenStage = 'picker' | 'import' | 'catalog' | 'prepare'

export class FolderOpenFailure extends Error {
  constructor(readonly stage: FolderOpenStage, cause: unknown) {
    super(stage === 'import' ? 'workspaceImportFailed' : 'folderOpenFailed', { cause })
    this.name = 'FolderOpenFailure'
  }
}

export async function folderOpenStep<T>(stage: FolderOpenStage, operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (failure) {
    throw failure instanceof FolderOpenFailure ? failure : new FolderOpenFailure(stage, failure)
  }
}

export function isFolderPickerCancellation(failure: unknown): boolean {
  if (typeof failure !== 'object') return false
  if (failure === null) return false
  if ('code' in failure) {
    return ['ERR_FILE_PICKING_CANCELLED', 'ERR_PICKER_CANCELLED'].some(code => code === failure.code)
  }
  if (!(failure instanceof Error)) return false
  return failure.message === 'cancelled'
}

export function folderOpenMessage(failure: FolderOpenFailure) {
  if (failure.stage === 'picker') return 'mobile.vaults.folderPickerFailed' as const
  if (failure.stage === 'catalog') return 'mobile.vaults.folderCatalogFailed' as const
  return 'mobile.vaults.folderReadFailed' as const
}
