import { normalizeExternalUrl } from '../../../../../src/utils/externalUrl'

type NativeWysiwygEditorLinkState = {
  activeLink?: unknown
}

export function nativeWysiwygInitialExternalLinkValue(
  editorState: NativeWysiwygEditorLinkState | null | undefined,
): string {
  return typeof editorState?.activeLink === 'string' ? editorState.activeLink : ''
}

export function nativeWysiwygNormalizedExternalLink(value: string): string | null {
  return normalizeExternalUrl(value)
}

export function nativeWysiwygCanSaveExternalLink(value: string): boolean {
  return nativeWysiwygNormalizedExternalLink(value) !== null
}
