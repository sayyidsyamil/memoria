import {
  expectAtLeast,
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'
import {
  nativeSidebarMetricContract,
} from './nativeSidebarItemLayoutMetrics.ts'

type FolderTreeMetrics = {
  root: NativeLayoutMetric | undefined
  memoria: NativeLayoutMetric | undefined
  memoriaMobile: NativeLayoutMetric | undefined
  memoriaReleases: NativeLayoutMetric | undefined
  writing: NativeLayoutMetric | undefined
  writingDrafts: NativeLayoutMetric | undefined
  writingEssays: NativeLayoutMetric | undefined
}

const folderMetricSpecs = [
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset, id: 'sidebar.folder.writing' },
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset + nativeSidebarMetricContract.folderRowIndent, id: 'sidebar.folder.writing-essays' },
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset + nativeSidebarMetricContract.folderRowIndent, id: 'sidebar.folder.writing-drafts' },
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset, id: 'sidebar.folder.memoria' },
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset + nativeSidebarMetricContract.folderRowIndent, id: 'sidebar.folder.memoria-mobile-ui' },
  { expectedLeftInset: nativeSidebarMetricContract.folderRowContentInset + nativeSidebarMetricContract.folderRowIndent, id: 'sidebar.folder.memoria-releases' },
] as const

const sidebarFolderPrefix = 'sidebar.folder.'

const sidebarFolderContainerSuffix = '.container'

const sidebarFolderRowSuffix = '.row'

export function assertFolderLayouts(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return folderMetricSpecsForMetrics(metrics).flatMap((spec) => assertFolderLayout({ ...spec, metrics }))
}

function folderMetricSpecsForMetrics(metrics: NativeLayoutMetricMap): Array<{ expectedLeftInset: number; id: string }> {
  const ids = sidebarFolderMetricIds(metrics)
  if (ids.length === 0) return [...folderMetricSpecs]

  return ids.map((id) => ({
    expectedLeftInset: expectedFolderLeftInset(metrics[`${id}.content`]?.x ?? null),
    id,
  }))
}

function sidebarFolderMetricIds(metrics: NativeLayoutMetricMap): string[] {
  return Object.keys(metrics)
    .filter((id) => id.startsWith(sidebarFolderPrefix) && id.endsWith(sidebarFolderRowSuffix))
    .map((id) => id.slice(0, -sidebarFolderRowSuffix.length))
}

function expectedFolderLeftInset(actual: number | null): number {
  if (actual === null) return nativeSidebarMetricContract.folderRowContentInset

  const depth = Math.max(
    0,
    Math.round((actual - nativeSidebarMetricContract.folderRowContentInset) / nativeSidebarMetricContract.folderRowIndent),
  )
  return nativeSidebarMetricContract.folderRowContentInset + depth * nativeSidebarMetricContract.folderRowIndent
}

export function assertFolderTreeLayout(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  const tree = folderTreeMetrics(metrics)
  const containers = sidebarFolderContainerMetrics(metrics)

  return [
    ...assertFolderTreeRootLayout(tree, containers.at(-1)),
    ...(hasFixtureFolderStackingMetrics(tree) ? assertFixtureFolderStacking(tree) : []),
  ]
}

function hasFixtureFolderStackingMetrics(tree: FolderTreeMetrics): boolean {
  return Boolean(
    tree.memoria
      && tree.memoriaMobile
      && tree.memoriaReleases
      && tree.writing
      && tree.writingDrafts
      && tree.writingEssays,
  )
}

function assertFixtureFolderStacking(tree: FolderTreeMetrics): NativeLayoutAssertionFailure[] {
  return [
    ...assertStackedMetricPair({
      current: tree.memoria,
      currentId: 'sidebar.folder.memoria',
      previous: tree.writing,
      previousId: 'sidebar.folder.writing',
    }),
    ...assertStackedMetricPair({
      current: tree.writingDrafts,
      currentId: 'sidebar.folder.writing-drafts',
      previous: tree.writingEssays,
      previousId: 'sidebar.folder.writing-essays',
    }),
    ...assertStackedMetricPair({
      current: tree.memoriaReleases,
      currentId: 'sidebar.folder.memoria-releases',
      previous: tree.memoriaMobile,
      previousId: 'sidebar.folder.memoria-mobile-ui',
    }),
  ]
}

function sidebarFolderContainerMetrics(metrics: NativeLayoutMetricMap): Array<{ id: string; metric: NativeLayoutMetric }> {
  return Object.entries(metrics)
    .filter(([id]) => id.startsWith(sidebarFolderPrefix) && id.endsWith(sidebarFolderContainerSuffix))
    .map(([id, metric]) => ({
      id: id.slice(0, -sidebarFolderContainerSuffix.length),
      metric,
    }))
}

function folderTreeMetrics(metrics: NativeLayoutMetricMap): FolderTreeMetrics {
  return {
    root: metrics['sidebar.folderTree.root'],
    memoria: metrics['sidebar.folder.memoria.container'],
    memoriaMobile: metrics['sidebar.folder.memoria-mobile-ui.container'],
    memoriaReleases: metrics['sidebar.folder.memoria-releases.container'],
    writing: metrics['sidebar.folder.writing.container'],
    writingDrafts: metrics['sidebar.folder.writing-drafts.container'],
    writingEssays: metrics['sidebar.folder.writing-essays.container'],
  }
}

function assertFolderTreeRootLayout(
  tree: FolderTreeMetrics,
  lastFolder: { id: string; metric: NativeLayoutMetric } | undefined,
): NativeLayoutAssertionFailure[] {
  const bottomReference = lastFolder?.metric ?? tree.memoria

  return [
    ...expectMetric({
      id: 'sidebar.folderTree.root',
      message: 'folder tree root is captured before checking native folder spacing',
      metric: tree.root,
    }),
    ...expectClose({
      actual: tree.root?.x ?? null,
      expected: nativeSidebarMetricContract.sectionHorizontalPadding,
      id: 'sidebar.folderTree.root',
      message: 'folder tree keeps desktop section inset',
    }),
    ...expectAtLeast({
      actual: tree.root && bottomReference ? tree.root.height - bottomReference.y - bottomReference.height : null,
      expected: nativeSidebarMetricContract.folderSectionContentPaddingBottom,
      id: 'sidebar.folderTree.root',
      message: 'folder tree keeps desktop bottom padding',
    }),
  ]
}

function assertStackedMetricPair({
  current,
  currentId,
  previous,
  previousId,
}: {
  current: NativeLayoutMetric | undefined
  currentId: string
  previous: NativeLayoutMetric | undefined
  previousId: string
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectMetric({
      id: previousId,
      message: 'previous metric is captured before checking native stacking',
      metric: previous,
    }),
    ...expectMetric({
      id: currentId,
      message: 'metric is captured before checking native stacking',
      metric: current,
    }),
    ...expectAtLeast({
      actual: previous && current ? current.y - previous.y - previous.height : null,
      expected: 0,
      id: currentId,
      message: 'metric starts after the previous metric',
      // Independently rounded native edges differ by at most half a canonical point.
      roundingTolerance: 0.5,
    }),
  ]
}

function assertFolderLayout({
  expectedLeftInset,
  id,
  metrics,
}: {
  expectedLeftInset: number
  id: string
  metrics: NativeLayoutMetricMap
}): NativeLayoutAssertionFailure[] {
  const row = metrics[`${id}.row`]
  const content = metrics[`${id}.content`]
  const label = metrics[`${id}.label`]

  return [
    ...expectMetric({ id, message: 'row is captured before checking native folder layout', metric: row }),
    ...expectMetric({ id, message: 'content is captured before checking native folder layout', metric: content }),
    ...expectMetric({ id, message: 'label is captured before checking native folder text alignment', metric: label }),
    ...assertFolderRowFrame({ content, expectedLeftInset, id, row }),
    ...assertFolderContentLayout(id, content),
    ...assertFolderLabelLayout(id, label),
  ]
}

function assertFolderRowFrame({
  content,
  expectedLeftInset,
  id,
  row,
}: {
  content: NativeLayoutMetric | undefined
  expectedLeftInset: number
  id: string
  row: NativeLayoutMetric | undefined
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: content?.x ?? null,
      expected: expectedLeftInset,
      id,
      message: 'folder content keeps desktop indentation',
    }),
    ...expectClose({
      actual: row?.height ?? null,
      expected: nativeSidebarMetricContract.folderRowHeight,
      id,
      message: 'folder row keeps desktop row height',
    }),
  ]
}

function assertFolderContentLayout(
  id: string,
  content: NativeLayoutMetric | undefined,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: content?.y ?? null,
      expected: nativeSidebarMetricContract.itemPadding.regular.top,
      id,
      message: 'folder content keeps desktop top padding',
    }),
    ...expectClose({
      actual: content?.height ?? null,
      expected: nativeSidebarMetricContract.folderRowContentHeight,
      id,
      message: 'folder content keeps desktop content height',
    }),
  ]
}

function assertFolderLabelLayout(
  id: string,
  label: NativeLayoutMetric | undefined,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: label?.height ?? null,
      expected: nativeSidebarMetricContract.itemLabelLineHeight,
      id,
      message: 'folder label keeps desktop line height',
    }),
    ...expectClose({
      actual: label?.y ?? null,
      expected: 0,
      id,
      message: 'folder label is vertically centered inside row content',
    }),
  ]
}
