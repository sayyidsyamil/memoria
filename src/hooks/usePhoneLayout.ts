import { useMediaQueryMatch } from './useMediaQueryMatch'

/** Phone widths: one pane at a time (TOL-193). iPad portrait (834 px) keeps the panes. */
export const PHONE_LAYOUT_QUERY = '(max-width: 640px)'

/** Whether the viewport is phone-width; always false when disabled (desktop, note windows). */
export function usePhoneLayout(enabled: boolean): boolean {
  return useMediaQueryMatch(PHONE_LAYOUT_QUERY, enabled)
}
