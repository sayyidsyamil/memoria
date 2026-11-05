import {
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'

type NoteListItemMetricSpec = {
  id: string
}

type NoteListItemMetrics = {
  body: NativeLayoutMetric | undefined
  footer: NativeLayoutMetric | undefined
  frame: NativeLayoutMetric | undefined
  header: NativeLayoutMetric | undefined
  subtitle: NativeLayoutMetric | undefined
  title: NativeLayoutMetric | undefined
}

type NoteListSurface = { kind: 'desktop' } | { kind: 'phone'; panel: NativeLayoutMetric | undefined }

export const nativeNoteListMetricContract = {
  contentGap: 8,
  frameX: 0,
  panelWidth: 340,
  padding: { bottom: 14, left: 16, right: 16, top: 14 },
  titleLineHeight: 18,
} as const

const noteListItemMetricSpecs: NoteListItemMetricSpec[] = [
  { id: 'noteList.item.workflow-orchestration' },
  { id: 'noteList.item.open-source-project' },
]

const noteListItemFrameSuffix = '.frame'

const noteListItemPrefix = 'noteList.item.'

export function assertNativeNoteListLayoutMetrics(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return [
    ...assertNoteListPanelLayout(metrics),
    ...noteListItemMetricSpecsForMetrics(metrics).flatMap((spec) => assertNoteListItemLayout({ ...spec, metrics, surface: { kind: 'desktop' } })),
  ]
}

export function assertNativePhoneNoteListLayoutMetrics(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  const panel = metrics['noteList.panel']

  return [
    ...expectMetric({
      id: 'noteList.panel',
      message: 'phone note-list panel is captured before checking native note row spacing',
      metric: panel,
    }),
    ...noteListItemMetricSpecsForMetrics(metrics).flatMap((spec) => assertNoteListItemLayout({ ...spec, metrics, surface: { kind: 'phone', panel } })),
  ]
}

function noteListItemMetricSpecsForMetrics(metrics: NativeLayoutMetricMap): NoteListItemMetricSpec[] {
  const liveRowIds = noteListItemMetricIds(metrics)
  if (liveRowIds.length === 0) return noteListItemMetricSpecs

  return liveRowIds.slice(0, noteListItemMetricSpecs.length).map((id) => ({ id }))
}

function noteListItemMetricIds(metrics: NativeLayoutMetricMap): string[] {
  return Object.keys(metrics)
    .filter((id) => id.startsWith(noteListItemPrefix) && id.endsWith(noteListItemFrameSuffix))
    .map((id) => id.slice(0, -noteListItemFrameSuffix.length))
}

function assertNoteListPanelLayout(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  const panel = metrics['noteList.panel']

  return [
    ...expectMetric({
      id: 'noteList.panel',
      message: 'note-list panel is captured before checking native note row spacing',
      metric: panel,
    }),
    ...expectClose({
      actual: panel?.width ?? null,
      expected: nativeNoteListMetricContract.panelWidth,
      id: 'noteList.panel',
      message: 'note list keeps desktop column width',
    }),
  ]
}

function assertNoteListItemLayout({
  id,
  metrics,
  surface,
}: {
  id: string
  metrics: NativeLayoutMetricMap
  surface: NoteListSurface
}): NativeLayoutAssertionFailure[] {
  const item = noteListItemMetrics(id, metrics)

  return [
    ...assertNoteListItemMetricsCaptured(id, item),
    ...assertNoteListItemSurfaceLayout(id, item, surface),
    ...assertNoteListItemContentLayout(id, item),
    ...assertNoteListItemTextLayout(id, item),
  ]
}

function noteListItemMetrics(id: string, metrics: NativeLayoutMetricMap): NoteListItemMetrics {
  return {
    body: metrics[`${id}.body`],
    footer: metrics[`${id}.footer`],
    frame: metrics[`${id}.frame`],
    header: metrics[`${id}.header`],
    subtitle: metrics[`${id}.subtitle`],
    title: metrics[`${id}.title`],
  }
}

function assertNoteListItemMetricsCaptured(id: string, item: NoteListItemMetrics): NativeLayoutAssertionFailure[] {
  return [
    ...expectMetric({ id: `${id}.frame`, message: 'note row surface is captured before checking native note-list layout', metric: item.frame }),
    ...expectMetric({ id: `${id}.body`, message: 'note row body is captured before checking native note-list layout', metric: item.body }),
    ...expectMetric({ id: `${id}.header`, message: 'note row header is captured before checking native note-list layout', metric: item.header }),
    ...expectMetric({ id: `${id}.title`, message: 'note row title is captured before checking native note-list layout', metric: item.title }),
    ...expectMetric({ id: `${id}.subtitle`, message: 'note row preview is captured before checking native note-list layout', metric: item.subtitle }),
    ...expectMetric({ id: `${id}.footer`, message: 'note row footer is captured before checking native note-list layout', metric: item.footer }),
  ]
}

function assertNoteListItemSurfaceLayout(
  id: string,
  item: NoteListItemMetrics,
  surface: NoteListSurface,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.frame?.x ?? null,
      expected: nativeNoteListMetricContract.frameX,
      id: `${id}.frame`,
      message: surface.kind === 'phone'
        ? 'phone note row surface starts at the note-list edge'
        : 'note row surface starts at the note-list column edge',
    }),
    ...expectClose({
      ...noteListSurfaceWidth(item.frame, surface),
      id: `${id}.frame`,
      message: surface.kind === 'phone'
        ? 'phone note row surface fills the phone note-list panel'
        : 'note row surface fills the desktop note-list column',
    }),
  ]
}

function noteListSurfaceWidth(frame: NativeLayoutMetric | undefined, surface: NoteListSurface) {
  if (surface.kind === 'phone') {
    return { actual: frame && surface.panel ? frame.width - surface.panel.width : null, expected: 0 }
  }

  return { actual: frame?.width ?? null, expected: nativeNoteListMetricContract.panelWidth }
}

function assertNoteListItemContentLayout(id: string, item: NoteListItemMetrics): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.body && item.header ? item.body.x + item.header.x : null,
      expected: nativeNoteListMetricContract.padding.left,
      id: `${id}.header`,
      message: 'note row content keeps desktop horizontal padding',
    }),
    ...expectClose({
      actual: item.body && item.frame && item.header
        ? item.frame.width - item.body.x - item.header.x - item.header.width
        : null,
      expected: nativeNoteListMetricContract.padding.right,
      id: `${id}.header`,
      message: 'note row content keeps desktop right padding',
    }),
    ...expectClose({
      actual: item.body && item.header ? item.body.y + item.header.y : null,
      expected: nativeNoteListMetricContract.padding.top,
      id: `${id}.header`,
      message: 'note row content keeps desktop top padding',
    }),
  ]
}

function assertNoteListItemTextLayout(id: string, item: NoteListItemMetrics): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: item.title?.height ?? null,
      expected: nativeNoteListMetricContract.titleLineHeight,
      id: `${id}.title`,
      message: 'note row title keeps desktop line height',
    }),
    ...expectClose({
      actual: item.header && item.subtitle ? item.subtitle.y - item.header.y - item.header.height : null,
      expected: nativeNoteListMetricContract.contentGap,
      id: `${id}.subtitle`,
      message: 'note row preview starts after the desktop content gap',
    }),
    ...expectClose({
      actual: item.footer && item.subtitle ? item.footer.y - item.subtitle.y - item.subtitle.height : null,
      expected: nativeNoteListMetricContract.contentGap,
      id: `${id}.footer`,
      message: 'note row chip row starts after the desktop content gap',
    }),
  ]
}
