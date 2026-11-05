import { readReadyEditorDocument } from '../../workspace/readyEditorDocument'
import { scheduleCreatedEditorFocus } from '../../workspace/mobileEditorFocus'

type InitialContentEditor = {
  setContentSilently: (content: string) => void
  getJSON: () => Promise<unknown>
}
type InitialContentOptions = {
  content: string
  editor: () => InitialContentEditor | null
  isReady: () => boolean
  shouldSync: () => boolean
  onError: (error: unknown) => void
}
export type NativeInitialContentSync = {
  cancel: () => void
  isReady: () => boolean
  settled: Promise<void>
}

/** A later read reply acknowledges the earlier silent write on the same bridge. */
export function beginNativeInitialContentSync(options: InitialContentOptions): NativeInitialContentSync {
  return new InitialContentSync(options)
}

export function recoverUntouchedEditorAfterInitialSyncFailure(options: {
  hasInteracted: boolean
  hasAcceptedChanges: boolean
  recover?: () => void
}) {
  if (options.hasInteracted || options.hasAcceptedChanges || !options.recover) return false
  options.recover()
  return true
}

class InitialContentSync implements NativeInitialContentSync {
  private active = true
  private acknowledged = false
  readonly settled: Promise<void>

  constructor(private readonly options: InitialContentOptions) {
    this.settled = readReadyEditorDocument({
      isReady: () => this.canRead(), read: () => this.install(),
    }).then(acknowledged => {
      if (this.active) this.acknowledged = acknowledged
    }).catch(error => { if (this.active) this.options.onError(error) })
  }

  cancel = () => { this.active = false }
  isReady = () => this.active && this.acknowledged

  private canRead() {
    return !this.active || !this.options.shouldSync() || (this.options.editor() !== null && this.options.isReady())
  }

  private async install() {
    if (!this.active || !this.options.shouldSync()) return false
    const editor = this.options.editor()
    if (!editor || !this.options.isReady()) return false
    editor.setContentSilently(this.options.content)
    await editor.getJSON()
    return true
  }
}

type CreatedFocusOptions = Parameters<typeof scheduleCreatedEditorFocus>[0] & {
  isBlocked: () => boolean
  wasInteracted: () => boolean
}

export function scheduleNativeCreatedNoteFocus(options: CreatedFocusOptions) {
  return scheduleCreatedEditorFocus({
    requests: options.requests, noteId: options.noteId,
    isReady: () => !options.isBlocked() && (options.wasInteracted() || options.isReady()),
    focus: () => { if (!options.wasInteracted()) options.focus() },
  })
}
