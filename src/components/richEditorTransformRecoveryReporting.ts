import { trackEvent } from '../lib/telemetry'
import {
  classifyRichEditorRecoveryError,
  type RichEditorTransformRecoveryReason,
} from './richEditorRecoveryClassifier'

// Classifying and reporting a recovered transform error needs no editor code, so the app shell
// can use it without pulling BlockNote into its first chunk (TOL-206).

export function richEditorTransformRecoveryErrorReason(error: unknown): RichEditorTransformRecoveryReason | null {
  return classifyRichEditorRecoveryError(error, 'transform')
}

export function isRecoverableEditorTransformError(error: unknown): boolean {
  return richEditorTransformRecoveryErrorReason(error) !== null
}

export const reportRecoveredEditorTransformError = (reason: RichEditorTransformRecoveryReason, error: unknown): void => {
  console.warn('[editor] Recovered rich-editor transform error:', error)
  trackEvent('rich_editor_transform_error_recovered', { reason })
}
