import { desktopPanelParity } from '../../ui/desktopParity'
import { mobileRadius, mobileSpace, mobileType } from '../../ui/tokens'

export const mobileCommandPaletteLayoutContract = {
  emptyMinHeight: 144,
  footerPaddingHorizontal: mobileSpace.md,
  footerPaddingVertical: 6,
  groupLabelPaddingBottom: mobileSpace.xs,
  groupLabelPaddingHorizontal: mobileSpace.md,
  groupLabelPaddingTop: mobileSpace.sm,
  inputMinHeight: 44,
  inputPaddingHorizontal: mobileSpace.lg,
  inputPaddingVertical: mobileSpace.md,
  inputTextSize: 15,
  overlayPaddingTop: desktopPanelParity.toolbarHeight + mobileSpace.xl,
  paletteBorderRadius: mobileRadius.lg,
  paletteMaxHeight: 520,
  paletteMaxWidth: 540,
  rowBorderRadius: mobileRadius.md,
  rowMarginHorizontal: mobileSpace.xs,
  rowMinHeight: 38,
  rowPaddingHorizontal: mobileSpace.md,
  rowPaddingVertical: 7,
  rowTextSize: mobileType.body,
  shortcutTextSize: mobileType.caption,
} as const
