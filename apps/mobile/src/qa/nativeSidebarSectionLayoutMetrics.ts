import {
  assertExactMetricStack,
  expectAtLeast,
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'
import {
  isPrimarySidebarItemMetricId,
  isTypeSidebarItemMetricId,
  nativeSidebarMetricContract,
  sidebarItemMetricIds,
  sidebarItemRowOrderForMetrics,
} from './nativeSidebarItemLayoutMetrics.ts'

type SectionTitleMetricSpec = {
  firstContentMetricId?: string
  sectionId: string
}

const sidebarSectionOrder = ['primary', 'favorites', 'views', 'types', 'folders']

const sectionTitleMetricSpecs: SectionTitleMetricSpec[] = [
  { firstContentMetricId: 'sidebar.item.personal-journal.row', sectionId: 'favorites' },
  { firstContentMetricId: 'sidebar.item.view-active-procedures.row', sectionId: 'views' },
  { firstContentMetricId: 'sidebar.item.essays.row', sectionId: 'types' },
  { firstContentMetricId: 'sidebar.folderTree.root', sectionId: 'folders' },
]

export function assertSidebarSectionLayouts(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return [
    ...assertPrimarySectionLayout(metrics),
    ...assertStackedSections(metrics, sidebarSectionOrder),
  ]
}

export function assertSectionTitleLayouts(metrics: NativeLayoutMetricMap, requireToggleMetric = false): NativeLayoutAssertionFailure[] {
  return sectionTitleMetricSpecsForMetrics(metrics).flatMap((spec) => assertSectionTitleLayout({ ...spec, metrics, requireToggleMetric }))
}

function sectionTitleMetricSpecsForMetrics(metrics: NativeLayoutMetricMap): SectionTitleMetricSpec[] {
  const ids = sidebarItemMetricIds(metrics)
  if (ids.length === 0) return sectionTitleMetricSpecs

  const groups = sidebarItemRowOrderForMetrics(metrics)
  const favorites = groups.find((group) => group.some((id) => !isPrimarySidebarItemMetricId(id) && !id.startsWith('sidebar.item.view-') && !isTypeSidebarItemMetricId(id)))
  const views = groups.find((group) => group.some((id) => id.startsWith('sidebar.item.view-')))
  const types = groups.find((group) => group.some(isTypeSidebarItemMetricId))

  return [
    { firstContentMetricId: firstSidebarRow(favorites), sectionId: 'favorites' },
    { firstContentMetricId: firstSidebarRow(views), sectionId: 'views' },
    { firstContentMetricId: firstSidebarRow(types), sectionId: 'types' },
    { firstContentMetricId: metrics['sidebar.folderTree.root'] ? 'sidebar.folderTree.root' : undefined, sectionId: 'folders' },
  ]
}

function firstSidebarRow(group: string[] | undefined) {
  return group?.[0] ? `${group[0]}.row` : undefined
}

function assertPrimarySectionLayout(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  const container = metrics['sidebar.section.primary.container']
  const firstRow = metrics['sidebar.item.inbox.row']
  const lastRow = metrics['sidebar.item.archive.row']

  return [
    ...expectMetric({
      id: 'sidebar.section.primary',
      message: 'primary section container is captured before checking native sidebar spacing',
      metric: container,
    }),
    ...expectClose({
      actual: firstRow?.y ?? null,
      expected: nativeSidebarMetricContract.topNavPadding.top,
      id: 'sidebar.section.primary',
      message: 'primary section keeps desktop top padding',
    }),
    ...expectClose({
      actual: firstRow?.x ?? null,
      expected: nativeSidebarMetricContract.topNavPadding.left,
      id: 'sidebar.section.primary',
      message: 'primary section keeps desktop left padding',
    }),
    ...expectClose({
      actual: container && lastRow ? container.height - lastRow.y - lastRow.height : null,
      expected: nativeSidebarMetricContract.topNavPadding.bottom,
      id: 'sidebar.section.primary',
      message: 'primary section keeps desktop bottom padding',
    }),
  ]
}

function assertStackedSections(metrics: NativeLayoutMetricMap, ids: string[]): NativeLayoutAssertionFailure[] {
  return assertExactMetricStack(metrics, {
    currentMessage: 'sidebar section is captured before checking section stacking',
    ids,
    metricId: (id) => `sidebar.section.${id}.container`,
    previousMessage: 'previous sidebar section is captured before checking section stacking',
    stackingMessage: 'section starts exactly after the previous sidebar section',
  })
}

function assertSectionTitleLayout({
  firstContentMetricId,
  metrics,
  requireToggleMetric,
  sectionId,
}: {
  firstContentMetricId?: string
  metrics: NativeLayoutMetricMap
  requireToggleMetric: boolean
  sectionId: string
}): NativeLayoutAssertionFailure[] {
  const id = `sidebar.section.${sectionId}`
  const titleRow = metrics[`${id}.row`]
  const titleLabel = sectionTitleLabelInRow(metrics, id)
  const toggle = metrics[`${id}.toggle`]
  const firstContent = firstContentMetricId ? metrics[firstContentMetricId] : undefined

  return [
    ...expectMetric({
      id,
      message: 'section title row is captured before checking native sidebar spacing',
      metric: titleRow,
    }),
    ...expectMetric({
      id,
      message: 'section title label is captured before checking native text alignment',
      metric: titleLabel,
    }),
    ...(requireToggleMetric ? expectMetric({
      id: `${id}.toggle`,
      message: 'section title toggle is captured before resolving native label coordinates',
      metric: toggle,
    }) : []),
    ...assertSectionTitleFrameLayout(id, titleRow),
    ...assertSectionTitleLabelLayout(id, titleRow, titleLabel),
    ...assertSectionFirstContentLayout({ firstContent, firstContentMetricId, titleRow }),
  ]
}

function sectionTitleLabelInRow(metrics: NativeLayoutMetricMap, id: string): NativeLayoutMetric | undefined {
  const label = metrics[`${id}.label`]
  const toggle = metrics[`${id}.toggle`]
  if (!label || !toggle) return label

  return { ...label, x: label.x + toggle.x, y: label.y + toggle.y }
}

function assertSectionTitleFrameLayout(
  id: string,
  titleRow: NativeLayoutMetric | undefined,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: titleRow?.x ?? null,
      expected: nativeSidebarMetricContract.sectionHorizontalPadding,
      id,
      message: 'section title keeps desktop section inset',
    }),
    ...expectAtLeast({
      actual: titleRow?.height ?? null,
      expected: nativeSidebarMetricContract.sectionTitleMinHeight,
      id,
      message: 'section title keeps desktop header height',
    }),
  ]
}

function assertSectionTitleLabelLayout(
  id: string,
  titleRow: NativeLayoutMetric | undefined,
  titleLabel: NativeLayoutMetric | undefined,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: titleLabel?.height ?? null,
      expected: nativeSidebarMetricContract.sectionTitleLineHeight,
      id,
      message: 'section title label keeps desktop line height',
    }),
    ...expectClose({
      actual: titleLabel?.y ?? null,
      expected: titleRow
        ? (titleRow.height - nativeSidebarMetricContract.sectionTitleLineHeight) / 2
        : (nativeSidebarMetricContract.sectionTitleMinHeight - nativeSidebarMetricContract.sectionTitleLineHeight) / 2,
      id,
      message: 'section title label keeps desktop vertical placement',
    }),
  ]
}

function assertSectionFirstContentLayout({
  firstContent,
  firstContentMetricId,
  titleRow,
}: {
  firstContent: NativeLayoutMetric | undefined
  firstContentMetricId: string | undefined
  titleRow: NativeLayoutMetric | undefined
}): NativeLayoutAssertionFailure[] {
  if (!firstContentMetricId) return []

  return [
    ...expectMetric({
      id: firstContentMetricId,
      message: 'first section content is captured before checking native sidebar spacing',
      metric: firstContent,
    }),
    ...expectClose({
      actual: titleRow && firstContent ? firstContent.y - titleRow.y - titleRow.height : null,
      expected: 0,
      id: firstContentMetricId,
      message: 'first row starts exactly after the sidebar section title',
    }),
  ]
}
