import { StyleSheet } from 'react-native'
import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { mobileRadius } from '../../ui/tokens'

export function createEditorBlockStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  return {
    mobileColors, metrics,
    textStyles: { ...bodyStyles(mobileColors, metrics), ...headingStyles(mobileColors, metrics) },
    titleBlockStyles: titleStyles(mobileColors, metrics),
    inlineStyles: inlineStyles(mobileColors, metrics),
    listStyles: listStyles(mobileColors, metrics),
    quoteStyles: quoteStyles(mobileColors, metrics),
    codeBlockStyles: codeStyles(mobileColors, metrics),
    dividerStyles: dividerStyles(mobileColors, metrics),
    tableStyles: tableStyles(mobileColors, metrics),
  }
}

function bodyStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    body: {
      flex: 1, color: colors.text,
      fontSize: editor.bodyFontSize, lineHeight: editor.bodyLineHeight,
    },
    paragraph: {
      color: colors.text, fontSize: editor.bodyFontSize,
      lineHeight: editor.bodyLineHeight, marginBottom: editor.paragraphSpacing,
    },
  })
}

function headingStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    heading: {
      color: colors.text, fontSize: editor.h2FontSize, fontWeight: '600',
      lineHeight: editor.h2LineHeight, marginBottom: editor.h2MarginBottom, marginTop: editor.h2MarginTop,
    },
    headingFour: {
      fontSize: editor.h4FontSize, lineHeight: editor.h4LineHeight,
      marginBottom: editor.h4MarginBottom, marginTop: editor.h4MarginTop,
    },
    headingOne: {
      fontSize: editor.h1FontSize, fontWeight: '700', lineHeight: editor.h1LineHeight,
      marginBottom: 0, marginTop: 0,
    },
    headingSmall: {
      fontSize: editor.h3FontSize, lineHeight: editor.h3LineHeight,
      marginBottom: editor.h3MarginBottom, marginTop: editor.h3MarginTop,
    },
  })
}

function titleStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    container: {
      borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
      marginBottom: editor.h1MarginBottom, paddingBottom: editor.h1PaddingBottom,
    },
  })
}

function inlineStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    bold: { color: colors.text, fontWeight: '700' },
    code: {
      overflow: 'hidden', borderRadius: 3, backgroundColor: colors.graySoft, color: colors.textMuted,
      fontFamily: 'Menlo', fontSize: editor.inlineCodeFontSize,
      paddingHorizontal: editor.inlineCodePaddingHorizontal, paddingVertical: editor.inlineCodePaddingVertical,
    },
    italic: { color: colors.text, fontStyle: 'italic' },
    link: { color: colors.primary, textDecorationLine: 'underline' },
    strike: { color: colors.textMuted, textDecorationLine: 'line-through' },
    wikilink: { color: colors.primary },
  })
}

function listStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    group: { marginBottom: editor.paragraphSpacing },
    marker: {
      color: colors.primary, fontSize: editor.listBulletSize,
      lineHeight: editor.bodyLineHeight, minWidth: editor.listIndentSize,
    },
    row: { flexDirection: 'row', gap: editor.listBulletGap, marginBottom: editor.listItemSpacing },
    taskIcon: { width: editor.listIndentSize, alignItems: 'center', justifyContent: 'center' },
    taskRow: { flexDirection: 'row', gap: editor.listCheckboxGap, marginBottom: editor.listItemSpacing },
  })
}

function quoteStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    container: {
      borderLeftColor: colors.primary, borderLeftWidth: 3,
      marginVertical: editor.quoteMarginVertical, paddingLeft: editor.quotePaddingLeft,
    },
    text: {
      color: colors.textMuted, fontSize: editor.bodyFontSize,
      fontStyle: 'italic', lineHeight: editor.bodyLineHeight,
    },
  })
}

function codeStyles(colors: MobileColors, metrics: MobileMetrics) {
  const { editor, space } = metrics
  return StyleSheet.create({
    code: { color: colors.text, fontFamily: 'Menlo', fontSize: editor.inlineCodeFontSize, lineHeight: metrics.size(20) },
    container: {
      borderColor: colors.border, borderRadius: mobileRadius.sm, borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: colors.sidebar, marginVertical: space.md, paddingHorizontal: space.md, paddingVertical: space.sm,
    },
    language: {
      color: colors.textMuted, fontSize: metrics.size(11), fontWeight: '600',
      marginBottom: space.xs, textTransform: 'uppercase',
    },
  })
}

function dividerStyles(colors: MobileColors, { editor }: MobileMetrics) {
  return StyleSheet.create({
    divider: {
      borderTopColor: colors.border, borderTopWidth: editor.horizontalRuleThickness,
      marginVertical: editor.horizontalRuleMarginVertical,
    },
  })
}

function tableStyles(colors: MobileColors, metrics: MobileMetrics) {
  const { editor, space } = metrics
  return StyleSheet.create({
    cell: {
      flex: 1, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border, borderRightWidth: StyleSheet.hairlineWidth,
      color: colors.text, fontSize: editor.tableFontSize, lineHeight: metrics.size(20),
      paddingHorizontal: editor.tableCellPaddingHorizontal, paddingVertical: editor.tableCellPaddingVertical,
    },
    headerCell: { backgroundColor: colors.card, fontWeight: '600' },
    headerRow: { backgroundColor: colors.card },
    row: { flexDirection: 'row' },
    table: {
      overflow: 'hidden', borderColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth,
      borderRadius: mobileRadius.sm, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.md,
    },
  })
}
