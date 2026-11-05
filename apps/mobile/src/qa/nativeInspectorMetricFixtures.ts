import { desktopPanelParity, desktopPropertyParity, desktopRelationshipParity } from '../ui/desktopParity'
import { mobileSpace } from '../ui/tokens'
import { latestNativeLayoutMetrics, type NativeLayoutMetric, nativePropertiesMetricContract, nativeWysiwygEditorMetricContract } from './nativeLayoutMetrics'
import { containerMetric, phoneRootMetric, phoneScreenMetric } from './nativeSidebarMetricFixtures'

const wysiwygToolbarActions = ['action.bold', 'action.italic', 'action.link', 'action.wikilink', 'group.headings', 'group.lists', 'group.insert', 'group.more'] as const

type WysiwygEditorMetricOptions = {
  actionGap?: number
  actionSize?: number
  formHeight?: number
  formWidth?: number
  toolbarHostBottomGap?: number
  toolbarX?: number
  toolbarY?: number
}

export function wysiwygEditorMetric(options: WysiwygEditorMetricOptions = {}): NativeLayoutMetric[] {
  const {
    actionGap = nativeWysiwygEditorMetricContract.toolbarActionGap,
    actionSize = nativeWysiwygEditorMetricContract.toolbarActionSize,
    formHeight = 640,
    formWidth = 760,
    toolbarHostBottomGap = 0,
    toolbarX = nativeWysiwygEditorMetricContract.toolbarHostPaddingHorizontal,
    toolbarY = nativeWysiwygEditorMetricContract.toolbarHostPaddingTop,
  } = options
  const toolbarHostHeight = toolbarY + actionSize + mobileSpace.xs

  return [
    containerMetric({
      height: formHeight,
      id: 'editor.wysiwyg.form',
      width: formWidth,
    }),
    containerMetric({
      height: formHeight,
      id: 'editor.wysiwyg.richText',
      width: formWidth,
    }),
    containerMetric({
      height: toolbarHostHeight,
      id: 'editor.wysiwyg.toolbarHost',
      width: formWidth,
      y: formHeight - toolbarHostHeight - toolbarHostBottomGap,
    }),
    containerMetric({
      height: actionSize,
      id: 'editor.wysiwyg.toolbar',
      width: wysiwygToolbarWidth(actionSize, actionGap),
      x: toolbarX,
      y: toolbarY,
    }),
    ...wysiwygToolbarActions.map((action, index) =>
      containerMetric({
        height: actionSize,
        id: `editor.wysiwyg.toolbar.${action}`,
        width: actionSize,
        x: index * (actionSize + actionGap),
      }),
    ),
  ]
}

function wysiwygToolbarWidth(actionSize: number, actionGap: number) {
  return wysiwygToolbarActions.length * actionSize + (wysiwygToolbarActions.length - 1) * actionGap
}

export function propertiesPanelMetric({ width = desktopPanelParity.inspectorWidth }: { width?: number } = {}): NativeLayoutMetric {
  return containerMetric({ height: 704, id: 'properties.panel', width })
}

export function propertyRowMetric(
  id: string,
  {
    labelX = desktopPropertyParity.rowPaddingHorizontal,
    labelWidth = nativePropertiesMetricContract.labelWidth,
    panelWidth = desktopPanelParity.inspectorWidth,
    rowHeight = desktopPropertyParity.rowMinHeight,
    rowX = desktopPropertyParity.panelPadding,
    valueRightPadding = desktopPropertyParity.rowPaddingHorizontal,
  }: {
    labelX?: number
    labelWidth?: number
    panelWidth?: number
    rowHeight?: number
    rowX?: number
    valueRightPadding?: number
  } = {},
): NativeLayoutMetric[] {
  const rowWidth = panelWidth - desktopPropertyParity.panelPadding * 2
  const valueX = labelX + labelWidth + mobileSpace.sm
  const valueWidth = rowWidth - valueX - valueRightPadding

  return [
    containerMetric({
      height: rowHeight,
      id: `${id}.row`,
      width: rowWidth,
      x: rowX,
    }),
    containerMetric({
      height: 18,
      id: `${id}.label`,
      width: labelWidth,
      x: labelX,
      y: 5,
    }),
    containerMetric({
      height: 18,
      id: `${id}.value`,
      width: valueWidth,
      x: valueX,
      y: 5,
    }),
  ]
}

export function propertySectionMetric(
  id: string,
  {
    labelX = desktopPropertyParity.rowPaddingHorizontal,
    panelWidth = desktopPanelParity.inspectorWidth,
    rowHeight = 54,
    rowX = desktopPropertyParity.panelPadding,
  }: {
    labelX?: number
    panelWidth?: number
    rowHeight?: number
    rowX?: number
  } = {},
): NativeLayoutMetric[] {
  const rowWidth = panelWidth - desktopPropertyParity.panelPadding * 2

  return [
    containerMetric({
      height: rowHeight,
      id: `${id}.row`,
      width: rowWidth,
      x: rowX,
    }),
    containerMetric({
      height: 18,
      id: `${id}.label`,
      width: nativePropertiesMetricContract.labelWidth,
      x: labelX,
      y: 6,
    }),
    containerMetric({
      height: 28,
      id: `${id}.value`,
      width: rowWidth - labelX * 2,
      x: labelX,
      y: 24,
    }),
  ]
}

export function propertyActionMetric(
  id: string,
  {
    labelX = desktopPropertyParity.rowPaddingHorizontal,
    panelWidth = desktopPanelParity.inspectorWidth,
    rowHeight = desktopPropertyParity.rowMinHeight,
    rowX = desktopPropertyParity.panelPadding,
    valueRightPadding = desktopPropertyParity.rowPaddingHorizontal,
  }: {
    labelX?: number
    panelWidth?: number
    rowHeight?: number
    rowX?: number
    valueRightPadding?: number
  } = {},
): NativeLayoutMetric[] {
  const rowWidth = panelWidth - desktopPropertyParity.panelPadding * 2
  const contentWidth = rowWidth - desktopPropertyParity.rowPaddingHorizontal - valueRightPadding - mobileSpace.sm
  const labelWidth = contentWidth / 2
  const valueWidth = contentWidth - labelWidth
  const valueX = labelX + labelWidth + mobileSpace.sm

  return [
    containerMetric({
      height: rowHeight,
      id: `${id}.row`,
      width: rowWidth,
      x: rowX,
    }),
    containerMetric({
      height: 18,
      id: `${id}.label`,
      width: labelWidth,
      x: labelX,
      y: 5,
    }),
    containerMetric({
      height: 18,
      id: `${id}.value`,
      width: valueWidth,
      x: valueX,
      y: 5,
    }),
  ]
}

export function relationshipRowMetric(
  id: string,
  sectionId: string,
  {
    panelWidth = desktopPanelParity.inspectorWidth,
    rowWidth,
  }: {
    panelWidth?: number
    rowWidth?: number
  } = {},
): NativeLayoutMetric[] {
  const sectionValueWidth = panelWidth - desktopPropertyParity.panelPadding * 2 - desktopPropertyParity.rowPaddingHorizontal * 2
  const actualRowWidth = rowWidth ?? sectionValueWidth

  return [
    containerMetric({
      height: desktopPropertyParity.rowMinHeight,
      id: `${id}.row`,
      width: actualRowWidth,
    }),
    containerMetric({
      height: 18,
      id: `${id}.target`,
      width: actualRowWidth - desktopRelationshipParity.removeIconSize - desktopRelationshipParity.rowGap,
      x: desktopRelationshipParity.rowPaddingHorizontal,
      y: desktopRelationshipParity.rowPaddingVertical,
    }),
    containerMetric({
      height: 18,
      id: `${id}.text`,
      width: 160,
      x: desktopRelationshipParity.iconSize + desktopRelationshipParity.rowGap,
      y: 0,
    }),
    containerMetric({
      height: 28,
      id: `${sectionId}.value`,
      width: sectionValueWidth,
      x: desktopPropertyParity.rowPaddingHorizontal,
      y: 24,
    }),
  ]
}

export function invalidPhonePropertyMetrics() {
  const phoneWidth = 390
  return latestNativeLayoutMetrics(
      [
        phoneRootMetric({ width: phoneWidth }),
        phoneScreenMetric('properties', { width: phoneWidth }),
        propertiesPanelMetric({ width: phoneWidth }),
        propertyRowMetric('properties.row.type', {
          labelX: 0,
          panelWidth: phoneWidth,
          rowHeight: 20,
          rowX: 0,
          valueRightPadding: 0,
        }),
        propertyRowMetric('properties.row.created', { panelWidth: phoneWidth }),
        propertyRowMetric('properties.row.modified', {
          panelWidth: phoneWidth,
        }),
        propertyRowMetric('properties.row.workspace', {
          panelWidth: phoneWidth,
        }),
        propertyRowMetric('properties.row.links', { panelWidth: phoneWidth }),
        propertySectionMetric('properties.section.tags', {
          panelWidth: phoneWidth,
        }),
        propertySectionMetric('properties.section.belongs-to', {
          panelWidth: phoneWidth,
        }),
        propertyActionMetric('properties.action.add-property', {
          panelWidth: phoneWidth,
          rowX: 0,
          valueRightPadding: 0,
        }),
        propertyActionMetric('properties.action.add-relationship', {
          panelWidth: phoneWidth,
        }),
        relationshipRowMetric('properties.relationship.llm-workflow', 'properties.section.belongs-to', {
          panelWidth: phoneWidth,
          rowWidth: 260,
        }),
      ].flat(),
    )
}
