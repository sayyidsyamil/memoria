import { TOUCH_INPUT_QUERY } from '../lib/touchInput'
import { isWebBuild } from '../utils/webBuild'
import { useMediaQueryMatch } from './useMediaQueryMatch'

/** Whether the web build is driven by a finger (TOL-24); always false on the desktop app. */
export function useTouchInput(): boolean {
  return useMediaQueryMatch(TOUCH_INPUT_QUERY, isWebBuild())
}
