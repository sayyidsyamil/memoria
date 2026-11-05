import { desktopNoteItemParity, desktopPanelParity, desktopSidebarParity } from '../ui/desktopParity'
import { latestNativeLayoutMetrics, type NativeLayoutMetric, nativePhoneShellMetricContract } from './nativeLayoutMetrics'

export function itemMetric(
  id: string,
  {
    hasCount,
    rowHeight = hasCount ? 32 : 30,
    rowX = 6,
    y = 0,
  }: {
    hasCount: boolean
    rowHeight?: number
    rowX?: number
    y?: number
  },
): NativeLayoutMetric[] {
  const contentHeight = hasCount ? 20 : 18
  const contentWidth = hasCount ? 227.5 : 219.5
  const rowWidth = 247.5

  return [
    {
      height: rowHeight,
      id: `${id}.row`,
      platform: 'ios',
      width: rowWidth,
      x: rowX,
      y,
    },
    {
      height: contentHeight,
      id: `${id}.content`,
      platform: 'ios',
      width: contentWidth,
      x: 12,
      y: hasCount ? 6 : 7,
    },
    {
      height: desktopSidebarParity.itemLabelLineHeight,
      id: `${id}.label`,
      platform: 'ios',
      width: hasCount ? 174.5 : 196.5,
      x: 23,
      y: hasCount ? 1 : 0,
    },
    ...(hasCount ? countPillMetric(`${id}.count`) : []),
  ]
}

export function countPillMetric(
  id: string,
  {
    compact = false,
    textY = compact ? 2 : 3,
  }: {
    compact?: boolean
    textY?: number
  } = {},
): NativeLayoutMetric[] {
  const height = compact ? desktopSidebarParity.countPillCompactHeight : desktopSidebarParity.countPillHeight

  return [
    {
      height,
      id: `${id}.container`,
      platform: 'ios',
      width: 22,
      x: 202,
      y: 0,
    },
    {
      height: 14,
      id: `${id}.text`,
      platform: 'ios',
      width: 18,
      x: 2,
      y: textY,
    },
  ]
}

export function nativePhoneListMetrics({ firstId, secondId, width }: { firstId: string; secondId: string; width: number }) {
  return latestNativeLayoutMetrics([phoneRootMetric({ width }), phoneScreenMetric('list', { width }), noteListPanelMetric({ width }), noteListItemMetric(firstId, { frameWidth: width, selected: true }), noteListItemMetric(secondId, { frameWidth: width })].flat())
}

export function noteListPanelMetric({ width = desktopPanelParity.noteListWidth }: { width?: number } = {}): NativeLayoutMetric {
  return {
    height: 768,
    id: 'noteList.panel',
    platform: 'ios',
    width,
    x: 0,
    y: 0,
  }
}

export function phoneRootMetric({ height = 760, width = 390 }: { height?: number; width?: number } = {}): NativeLayoutMetric {
  return containerMetric({ height, id: 'phone.root', width })
}

export function phoneScreenMetric(
  state: 'editor' | 'list' | 'properties' | 'sidebar',
  {
    height = 704,
    width = 390,
  }: {
    height?: number
    width?: number
  } = {},
): NativeLayoutMetric {
  return containerMetric({ height, id: `phone.${state}.screen`, width })
}

export function phoneSidebarDrawerMetric({ drawerWidth, width }: { drawerWidth?: number; width: number }): NativeLayoutMetric[] {
  const actualDrawerWidth = drawerWidth ?? Math.round(width * nativePhoneShellMetricContract.drawerWidthRatio)

  return [
    containerMetric({
      height: 704,
      id: 'phone.sidebar.drawer',
      width: actualDrawerWidth,
    }),
    containerMetric({
      height: 704,
      id: 'phone.sidebar.preview',
      width,
      x: actualDrawerWidth,
    }),
  ]
}

type NoteListItemMetricOptions = {
    bodyX?: number
    frameWidth?: number
    headerX?: number
    headerY?: number
    selected?: boolean
    titleHeight?: number
    y?: number
  }

export function noteListItemMetric(id: string, options: NoteListItemMetricOptions = {}): NativeLayoutMetric[] {
  const {
    bodyX,
    frameWidth = desktopPanelParity.noteListWidth,
    headerX,
    headerY = desktopNoteItemParity.padding.top,
    selected = false,
    titleHeight = desktopNoteItemParity.titleLineHeight,
    y = 0,
  } = options
  const bodyOffsetX = bodyX ?? (selected ? desktopNoteItemParity.borderLeftWidth : 0)
  const headerOffsetX = headerX ?? (selected ? desktopNoteItemParity.selectedPaddingLeft : desktopNoteItemParity.padding.left)
  const bodyWidth = frameWidth - bodyOffsetX
  const headerWidth = bodyWidth - headerOffsetX - desktopNoteItemParity.padding.right
  const subtitleHeight = desktopNoteItemParity.snippetLineHeight * 2
  const subtitleY = headerY + desktopNoteItemParity.titleLineHeight + desktopNoteItemParity.contentGap
  const footerY = subtitleY + subtitleHeight + desktopNoteItemParity.contentGap
  const rowHeight = footerY + 20 + desktopNoteItemParity.padding.bottom

  return [
    containerMetric({ height: rowHeight, id: `${id}.frame`, width: frameWidth, y }),
    containerMetric({ height: rowHeight, id: `${id}.body`, width: bodyWidth, x: bodyOffsetX }),
    containerMetric({ height: desktopNoteItemParity.titleLineHeight, id: `${id}.header`, width: headerWidth, x: headerOffsetX, y: headerY }),
    containerMetric({ height: titleHeight, id: `${id}.title`, width: headerWidth - 24 }),
    containerMetric({ height: subtitleHeight, id: `${id}.subtitle`, width: headerWidth, x: headerOffsetX, y: subtitleY }),
    containerMetric({ height: 20, id: `${id}.footer`, width: headerWidth, x: headerOffsetX, y: footerY }),
  ]
}

export function folderMetric(id: string, contentX: number, y = 0): NativeLayoutMetric[] {
  return [
    {
      height: 30,
      id: `${id}.row`,
      platform: 'ios',
      width: 247.5,
      x: 0,
      y,
    },
    {
      height: 18,
      id: `${id}.content`,
      platform: 'ios',
      width: 219.5,
      x: contentX,
      y: 6,
    },
    {
      height: desktopSidebarParity.itemLabelLineHeight,
      id: `${id}.label`,
      platform: 'ios',
      width: 172.5,
      x: 52,
      y: 0,
    },
  ]
}

export function folderTreeRootMetric(
  y: number,
  {
    height = 120,
    x = 0,
  }: {
    height?: number
    x?: number
  } = {},
): NativeLayoutMetric[] {
  return [
    {
      height,
      id: 'sidebar.folderTree.root',
      platform: 'ios',
      width: 247.5,
      x,
      y,
    },
  ]
}

export function sectionMetric(sectionId: string, rowHeight = 30): NativeLayoutMetric[] {
  const labelY = (rowHeight - desktopSidebarParity.sectionTitleLineHeight) / 2

  return [
    {
      height: rowHeight,
      id: `sidebar.section.${sectionId}.row`,
      platform: 'ios',
      width: 247.5,
      x: 6,
      y: 0,
    },
    {
      height: desktopSidebarParity.sectionTitleLineHeight,
      id: `sidebar.section.${sectionId}.label`,
      platform: 'ios',
      width: 206.5,
      x: 27,
      y: labelY,
    },
  ]
}

export function containerMetric({ height, id, width = 247.5, x = 0, y = 0 }: { height: number; id: string; width?: number; x?: number; y?: number }): NativeLayoutMetric {
  return {
    height,
    id,
    platform: 'ios',
    width,
    x,
    y,
  }
}
