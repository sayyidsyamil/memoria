import type { ViewStyle } from 'react-native'

export const mobilePaneFooterRowHeight = 48

/** Include the home-indicator area in the height, not as an offset above it. */
export function mobilePaneFooterFrame(bottom = 0): ViewStyle {
  return {
    height: mobilePaneFooterRowHeight + bottom,
    paddingBottom: 0,
    alignItems: 'center',
    flexShrink: 0,
  }
}
