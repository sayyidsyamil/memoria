import {
  assertExactMetricStack,
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'

type SidebarPadding = {
  bottom: number
  left: number
  right: number
  top: number
}

type CountPillLayout = {
  compact?: boolean
  id: string
}

type SidebarItemMetricSpec = {
  contentHeight: number
  id: string
  padding: SidebarPadding
}

type SidebarItemMetrics = {
  content: NativeLayoutMetric | undefined
  label: NativeLayoutMetric | undefined
  row: NativeLayoutMetric | undefined
}

export const nativeSidebarMetricContract = {
  countPill: {
    compactHeight: 18,
    height: 20,
  },
  folderSectionContentPaddingBottom: 8,
  folderRowContentHeight: 18,
  folderRowContentInset: 12,
  folderRowHeight: 30,
  folderRowIndent: 25,
  itemContentHeight: {
    regular: 18,
    withCount: 20,
  },
  itemLabelLineHeight: 18,
  itemPadding: {
    regular: { bottom: 6, left: 12, right: 16, top: 6 },
    withCount: { bottom: 6, left: 12, right: 8, top: 6 },
  },
  primarySectionItemCount: 3,
  sectionHorizontalPadding: 6,
  sectionTitleMinHeight: 30,
  sectionTitleLineHeight: 14,
  topNavPadding: { bottom: 4, left: 6, right: 6, top: 4 },
} as const

const sidebarItemMetricSpecs: SidebarItemMetricSpec[] = [
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.inbox', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.all-notes', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.archive', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.regular, id: 'sidebar.item.personal-journal', padding: nativeSidebarMetricContract.itemPadding.regular },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.regular, id: 'sidebar.item.memoria-mvp', padding: nativeSidebarMetricContract.itemPadding.regular },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.view-active-procedures', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.essays', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.procedures', padding: nativeSidebarMetricContract.itemPadding.withCount },
  { contentHeight: nativeSidebarMetricContract.itemContentHeight.withCount, id: 'sidebar.item.responsibilities', padding: nativeSidebarMetricContract.itemPadding.withCount },
]

const primarySidebarItemMetricIds = ['sidebar.item.inbox', 'sidebar.item.all-notes', 'sidebar.item.archive'] as const

const fixtureTypeSidebarItemMetricIds = ['sidebar.item.essays', 'sidebar.item.procedures', 'sidebar.item.responsibilities'] as const

const sidebarItemPrefix = 'sidebar.item.'

const sidebarItemRowSuffix = '.row'

const sidebarCountContainerSuffix = '.count.container'

const sidebarItemRowOrder = [
  ['sidebar.item.inbox', 'sidebar.item.all-notes', 'sidebar.item.archive'],
  ['sidebar.item.personal-journal', 'sidebar.item.memoria-mvp'],
  ['sidebar.item.essays', 'sidebar.item.procedures', 'sidebar.item.responsibilities'],
] as const

const countPillMetricSpecs: CountPillLayout[] = [
  { id: 'sidebar.item.inbox.count' },
  { id: 'sidebar.item.all-notes.count' },
  { id: 'sidebar.item.archive.count' },
  { id: 'sidebar.item.view-active-procedures.count' },
  { id: 'sidebar.item.essays.count' },
  { id: 'sidebar.item.procedures.count' },
  { id: 'sidebar.item.responsibilities.count' },
  { compact: true, id: 'sidebar.section.types.count' },
]

export function assertSidebarItemLayouts(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return [
    ...sidebarItemMetricSpecsForMetrics(metrics).flatMap((spec) => assertSidebarItemLayout({ ...spec, metrics })),
    ...sidebarItemRowOrderForMetrics(metrics).flatMap((ids) => assertStackedRows(metrics, ids)),
  ]
}

function sidebarItemMetricSpecsForMetrics(metrics: NativeLayoutMetricMap): SidebarItemMetricSpec[] {
  const ids = sidebarItemMetricIds(metrics)
  if (ids.length === 0) return sidebarItemMetricSpecs

  const countIds = countPillIds(metrics)
  return ids.map((id) => {
    const hasCount = countIds.has(`${id}.count`)
    return {
      contentHeight: hasCount
        ? nativeSidebarMetricContract.itemContentHeight.withCount
        : nativeSidebarMetricContract.itemContentHeight.regular,
      id,
      padding: hasCount
        ? nativeSidebarMetricContract.itemPadding.withCount
        : nativeSidebarMetricContract.itemPadding.regular,
    }
  })
}

export function sidebarItemMetricIds(metrics: NativeLayoutMetricMap): string[] {
  return Object.keys(metrics)
    .filter((id) => id.startsWith(sidebarItemPrefix) && id.endsWith(sidebarItemRowSuffix))
    .map((id) => id.slice(0, -sidebarItemRowSuffix.length))
}

export function sidebarItemRowOrderForMetrics(metrics: NativeLayoutMetricMap): string[][] {
  const ids = sidebarItemMetricIds(metrics)
  if (ids.length === 0) return sidebarItemRowOrder.map((group) => [...group])

  const primary = primarySidebarItemMetricIds.filter((id) => ids.includes(id))
  const views = ids.filter((id) => id.startsWith('sidebar.item.view-'))
  const types = ids.filter(isTypeSidebarItemMetricId)
  const favorites = ids.filter((id) => !isPrimarySidebarItemMetricId(id) && !views.includes(id) && !types.includes(id))

  return [primary, favorites, views, types].filter((group) => group.length > 1)
}

export function isPrimarySidebarItemMetricId(id: string): boolean {
  return primarySidebarItemMetricIds.includes(id as typeof primarySidebarItemMetricIds[number])
}

export function isTypeSidebarItemMetricId(id: string): boolean {
  return id.startsWith('sidebar.item.type-')
    || fixtureTypeSidebarItemMetricIds.includes(id as typeof fixtureTypeSidebarItemMetricIds[number])
}

function assertStackedRows(metrics: NativeLayoutMetricMap, ids: readonly string[]): NativeLayoutAssertionFailure[] {
  return assertExactMetricStack(metrics, {
    currentMessage: 'row is captured before checking sidebar row stacking',
    ids,
    metricId: (id) => `${id}.row`,
    previousMessage: 'previous row is captured before checking sidebar row stacking',
    stackingMessage: 'row starts exactly after the previous sidebar row',
  })
}

function assertSidebarItemLayout({
  contentHeight,
  id,
  metrics,
  padding,
}: {
  contentHeight: number
  id: string
  metrics: NativeLayoutMetricMap
  padding: SidebarPadding
}): NativeLayoutAssertionFailure[] {
  const item = sidebarItemMetrics(id, metrics)

  return [
    ...assertSidebarItemMetricsCaptured(id, item),
    ...assertSidebarItemFrameLayout({ contentHeight, id, item, padding }),
    ...assertSidebarItemContentLayout({ contentHeight, id, item, padding }),
    ...assertSidebarItemLabelLayout({ contentHeight, id, item }),
  ]
}

function sidebarItemMetrics(id: string, metrics: NativeLayoutMetricMap): SidebarItemMetrics {
  return {
    content: metrics[`${id}.content`],
    label: metrics[`${id}.label`],
    row: metrics[`${id}.row`],
  }
}

function assertSidebarItemMetricsCaptured(id: string, item: SidebarItemMetrics): NativeLayoutAssertionFailure[] {
  return [
    ...expectMetric({ id, message: 'row is captured before checking native padding', metric: item.row }),
    ...expectMetric({ id, message: 'content is captured before checking native padding', metric: item.content }),
    ...expectMetric({ id, message: 'label is captured before checking native text alignment', metric: item.label }),
  ]
}

function assertSidebarItemFrameLayout({
  contentHeight,
  id,
  item,
  padding,
}: {
  contentHeight: number
  id: string
  item: SidebarItemMetrics
  padding: SidebarPadding
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.row?.x ?? null,
      expected: nativeSidebarMetricContract.sectionHorizontalPadding,
      id,
      message: 'row keeps desktop section inset',
    }),
    ...expectClose({
      actual: item.row?.height ?? null,
      expected: padding.top + contentHeight + padding.bottom,
      id,
      message: 'row keeps desktop row height',
    }),
  ]
}

function assertSidebarItemContentLayout({
  contentHeight,
  id,
  item,
  padding,
}: {
  contentHeight: number
  id: string
  item: SidebarItemMetrics
  padding: SidebarPadding
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.content?.x ?? null,
      expected: padding.left,
      id,
      message: 'content keeps desktop left padding',
    }),
    ...expectClose({
      actual: item.content?.y ?? null,
      expected: padding.top,
      id,
      message: 'content keeps desktop top padding',
    }),
    ...expectClose({
      actual: item.content?.height ?? null,
      expected: contentHeight,
      id,
      message: 'content keeps desktop content height',
    }),
    ...assertSidebarItemPaddingRemainder(id, item, padding),
  ]
}

function assertSidebarItemPaddingRemainder(
  id: string,
  item: SidebarItemMetrics,
  padding: SidebarPadding,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.row && item.content ? item.row.width - item.content.x - item.content.width : null,
      expected: padding.right,
      id,
      message: 'content keeps desktop right padding',
    }),
    ...expectClose({
      actual: item.row && item.content ? item.row.height - item.content.height : null,
      expected: padding.top + padding.bottom,
      id,
      message: 'row keeps desktop vertical padding',
    }),
  ]
}

function assertSidebarItemLabelLayout({
  contentHeight,
  id,
  item,
}: {
  contentHeight: number
  id: string
  item: SidebarItemMetrics
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.label?.height ?? null,
      expected: nativeSidebarMetricContract.itemLabelLineHeight,
      id,
      message: 'label keeps desktop line height',
    }),
    ...expectClose({
      actual: item.label?.y ?? null,
      expected: (contentHeight - nativeSidebarMetricContract.itemLabelLineHeight) / 2,
      id,
      message: 'label is vertically centered inside row content',
    }),
  ]
}

export function assertCountPillLayouts(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return countPillMetricSpecsForMetrics(metrics).flatMap((spec) => assertCountPillLayout(metrics, spec))
}

function countPillMetricSpecsForMetrics(metrics: NativeLayoutMetricMap): CountPillLayout[] {
  const ids = [...countPillIds(metrics)]
  if (ids.length === 0) return countPillMetricSpecs

  return ids.map((id) => ({
    compact: id.startsWith('sidebar.section.'),
    id,
  }))
}

function countPillIds(metrics: NativeLayoutMetricMap): Set<string> {
  return new Set(Object.keys(metrics)
    .filter((id) => id.endsWith(sidebarCountContainerSuffix))
    .map((id) => id.slice(0, -'.container'.length)))
}

function assertCountPillLayout(
  metrics: NativeLayoutMetricMap,
  { compact = false, id }: CountPillLayout,
): NativeLayoutAssertionFailure[] {
  const container = metrics[`${id}.container`]
  const text = metrics[`${id}.text`]
  const expectedHeight = compact
    ? nativeSidebarMetricContract.countPill.compactHeight
    : nativeSidebarMetricContract.countPill.height

  return [
    ...expectMetric({ id, message: 'count pill container is captured before checking native alignment', metric: container }),
    ...expectMetric({ id, message: 'count pill text is captured before checking native alignment', metric: text }),
    ...expectClose({
      actual: container?.height ?? null,
      expected: expectedHeight,
      id,
      message: 'count pill keeps desktop height',
    }),
    ...expectClose({
      actual: text ? text.y + text.height / 2 : null,
      expected: expectedHeight / 2,
      id,
      message: 'count text is vertically centered inside native pill',
    }),
  ]
}
