import { describe, expect, it, vi } from 'vitest'
import { mobileMetrics } from '../../ui/mobileMetrics'
import { mobilePalettes } from '../../ui/theme/mobilePalette'
import { createEditorBlockStyles } from './mobileEditorBlockStyles'

vi.mock('react-native', () => ({ StyleSheet: { create: (value: object) => value, hairlineWidth: 0.5 } }))

describe.each(['light', 'dark'] as const)('editor block styles in %s mode', mode => {
  it.each([1, 1.2] as const)('uses the shared typography and spacing at scale %s', scale => {
    const metrics = mobileMetrics[scale]
    const colors = mobilePalettes[mode]
    const styles = createEditorBlockStyles(colors, metrics)
    expect(styles.textStyles.body.fontSize).toBe(metrics.editor.bodyFontSize)
    expect(styles.textStyles.body.lineHeight).toBe(metrics.editor.bodyLineHeight)
    expect(styles.textStyles.paragraph.marginBottom).toBe(metrics.editor.paragraphSpacing)
    expect(styles.textStyles.heading.marginTop).toBe(metrics.editor.h2MarginTop)
    expect(styles.textStyles.headingOne.fontSize).toBe(metrics.editor.h1FontSize)
    expect(styles.listStyles.row.gap).toBe(metrics.editor.listBulletGap)
    expect(styles.tableStyles.cell.paddingVertical).toBe(metrics.editor.tableCellPaddingVertical)
    expect(styles.tableStyles.cell.color).toBe(colors.text)
    expect(styles.tableStyles.cell.borderBottomWidth).toBe(0.5)
    expect(styles.quoteStyles.container.borderLeftWidth).toBe(3)
    expect(styles.codeBlockStyles.container.backgroundColor).toBe(colors.sidebar)
    expect(styles.inlineStyles.link.color).toBe(colors.primary)
  })
})
