import { describe, expect, it } from 'vitest'
import { desktopPanelParity } from '../../ui/desktopParity'
import { mobileRadius, mobileSpace, mobileType } from '../../ui/tokens'
import { mobileCommandPaletteLayoutContract } from './MobileCommandPaletteLayout'

describe('mobile command palette layout contract', () => {
  it('keeps the native command palette tied to desktop command palette density', () => {
    expect(mobileCommandPaletteLayoutContract).toMatchObject({
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
    })
  })
})
