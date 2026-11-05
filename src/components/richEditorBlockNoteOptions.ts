import { type RichEditorFileUrlResolver, richEditorFileUrlResolver } from './richEditorFileUrl'

export const RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS = ['previousBlockType'] as const

type RichEditorBlockNotePerformanceOptions = {
  animations: false
  disableExtensions: string[]
  readonly resolveFileUrl: RichEditorFileUrlResolver | undefined
}

export const RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS = {
  animations: false,
  disableExtensions: [...RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS],
  // Not a performance setting: it rides along because every rich editor spreads these options.
  // A getter, so the runtime is read when an editor is created rather than at import.
  get resolveFileUrl() {
    return richEditorFileUrlResolver()
  },
} satisfies RichEditorBlockNotePerformanceOptions
