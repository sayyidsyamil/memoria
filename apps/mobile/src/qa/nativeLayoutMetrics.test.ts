import { describe, expect, it } from 'vitest'
import { desktopNoteItemParity, desktopPanelParity, desktopPropertyParity, desktopSidebarParity } from '../ui/desktopParity'
import { mobileSpace } from '../ui/tokens'
import { assertNativeMobileLayoutMetrics, assertNativePhoneLayoutMetrics, assertNativeWysiwygEditorLayoutMetrics, formatNativeLayoutAssertionFailures, latestNativeLayoutMetrics, nativeNoteListMetricContract, nativePhoneShellMetricContract, nativePropertiesMetricContract, nativeSidebarMetricContract, nativeWysiwygEditorMetricContract, parseNativeLayoutMetrics } from './nativeLayoutMetrics'
import { propertiesPanelMetric, propertyRowMetric, propertySectionMetric, propertyActionMetric, relationshipRowMetric, invalidPhonePropertyMetrics, wysiwygEditorMetric } from './nativeInspectorMetricFixtures'
import { nativePhoneListMetrics, phoneRootMetric, phoneScreenMetric, phoneSidebarDrawerMetric, noteListPanelMetric, noteListItemMetric, containerMetric, itemMetric, sectionMetric, countPillMetric, folderTreeRootMetric, folderMetric } from './nativeSidebarMetricFixtures'

describe('native layout metrics', () => {
  it('keeps the native metric contract synced with desktop sidebar parity tokens', () => {
    expect(nativeSidebarMetricContract).toEqual({
      countPill: {
        compactHeight: desktopSidebarParity.countPillCompactHeight,
        height: desktopSidebarParity.countPillHeight,
      },
      folderSectionContentPaddingBottom: desktopSidebarParity.sectionContentPaddingBottom,
      folderRowContentHeight: desktopSidebarParity.folderRowContentHeight,
      folderRowContentInset: desktopSidebarParity.folderRowContentInset,
      folderRowHeight: desktopSidebarParity.folderRowHeight,
      folderRowIndent: desktopSidebarParity.folderRowIndent,
      itemContentHeight: desktopSidebarParity.itemContentHeight,
      itemLabelLineHeight: desktopSidebarParity.itemLabelLineHeight,
      itemPadding: desktopSidebarParity.itemPadding,
      primarySectionItemCount: 3,
      sectionHorizontalPadding: desktopSidebarParity.sectionHorizontalPadding,
      sectionTitleMinHeight: 30,
      sectionTitleLineHeight: desktopSidebarParity.sectionTitleLineHeight,
      topNavPadding: desktopSidebarParity.topNavPadding,
    })
    expect(nativeNoteListMetricContract).toEqual({
      contentGap: desktopNoteItemParity.contentGap,
      frameX: 0,
      panelWidth: desktopPanelParity.noteListWidth,
      padding: desktopNoteItemParity.padding,
      titleLineHeight: desktopNoteItemParity.titleLineHeight,
    })
  })

  it('keeps native editor and inspector contracts synced with desktop parity tokens', () => {
    expect(nativeWysiwygEditorMetricContract).toEqual({
      minFormHeight: 320,
      toolbarActionCount: 8,
      toolbarActionGap: mobileSpace.xs,
      toolbarActionSize: 44,
      toolbarHostPaddingHorizontal: mobileSpace.md,
      toolbarHostPaddingTop: mobileSpace.xs,
    })
    expect(nativePropertiesMetricContract).toEqual({
      labelWidth: 86,
      panelPadding: desktopPropertyParity.panelPadding,
      panelWidth: desktopPanelParity.inspectorWidth,
      relationshipRowMinHeight: desktopPropertyParity.rowMinHeight,
      rowMaxHeight: 96,
      rowMinHeight: desktopPropertyParity.rowMinHeight,
      rowPaddingHorizontal: desktopPropertyParity.rowPaddingHorizontal,
    })
    expect(nativePhoneShellMetricContract).toEqual({
      drawerMaxWidth: 320,
      drawerWidthRatio: 0.78,
      maxWidth: 899,
      minContentHeight: 320,
      minRootHeight: 480,
    })
  })

  it('parses simulator log metrics and keeps the latest metric per id', () => {
    const metrics = latestNativeLayoutMetrics(
      parseNativeLayoutMetrics(
        ['noise before metric', 'MEMORIA_MOBILE_LAYOUT_METRIC {"height":12,"id":"sidebar.item.inbox.row","platform":"ios","width":10,"x":1,"y":2}', 'MEMORIA_MOBILE_LAYOUT_METRIC {"height":32,"id":"sidebar.item.inbox.row","platform":"ios","width":247.5,"x":6,"y":4}', 'MEMORIA_MOBILE_LAYOUT_METRIC not-json'].join('\n'),
      ),
    )

    expect(metrics['sidebar.item.inbox.row']).toEqual({
      height: 32,
      id: 'sidebar.item.inbox.row',
      platform: 'ios',
      width: 247.5,
      x: 6,
      y: 4,
    })
  })

  it('accepts native phone list metrics that keep desktop note row spacing at full width', () => {
    const metrics = nativePhoneListMetrics({
      firstId: 'noteList.item.workflow-orchestration',
      secondId: 'noteList.item.open-source-project',
      width: 390,
    })

    expect(assertNativePhoneLayoutMetrics(metrics, 'list')).toEqual([])
  })

  it('accepts native phone list metrics from real-vault note ids', () => {
    const metrics = nativePhoneListMetrics({
      firstId: 'noteList.item.memoria-release-v2026-06-23.md',
      secondId: 'noteList.item.refactoring-newsletter-36-month-business-plan.md',
      width: 402,
    })

    expect(assertNativePhoneLayoutMetrics(metrics, 'list')).toEqual([])
  })

  it('reports native phone sidebar metrics that miss drawer or shared sidebar spacing evidence', () => {
    const phoneWidth = 390
    const metrics = latestNativeLayoutMetrics(
      [
        phoneRootMetric({ width: phoneWidth }),
        phoneScreenMetric('sidebar', { width: phoneWidth }),
        phoneSidebarDrawerMetric({ drawerWidth: 240, width: phoneWidth }),
        noteListPanelMetric({ width: phoneWidth }),
        noteListItemMetric('noteList.item.workflow-orchestration', {
          frameWidth: phoneWidth,
          selected: true,
          y: 0,
        }),
        noteListItemMetric('noteList.item.open-source-project', {
          frameWidth: phoneWidth,
          y: 118,
        }),
      ].flat(),
    )

    const formatted = formatNativeLayoutAssertionFailures(assertNativePhoneLayoutMetrics(metrics, 'sidebar'))

    expect(formatted).toContain('phone.sidebar.drawer: phone sidebar drawer keeps the compact navigation width')
    expect(formatted).toContain('sidebar.item.inbox: row is captured before checking native padding')
  })

  it('accepts native phone properties metrics that keep desktop inspector density', () => {
    const phoneWidth = 390
    const metrics = latestNativeLayoutMetrics(
      [
        phoneRootMetric({ width: phoneWidth }),
        phoneScreenMetric('properties', { width: phoneWidth }),
        propertiesPanelMetric({ width: phoneWidth }),
        propertyRowMetric('properties.row.type', { panelWidth: phoneWidth }),
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
        }),
        propertyActionMetric('properties.action.add-relationship', {
          panelWidth: phoneWidth,
        }),
        relationshipRowMetric('properties.relationship.llm-workflow', 'properties.section.belongs-to', {
          panelWidth: phoneWidth,
        }),
      ].flat(),
    )

    expect(assertNativePhoneLayoutMetrics(metrics, 'properties')).toEqual([])
  })

  it('reports native phone properties metrics that lose desktop row padding', () => {
    const metrics = invalidPhonePropertyMetrics()

    const formatted = formatNativeLayoutAssertionFailures(assertNativePhoneLayoutMetrics(metrics, 'properties'))

    expect(formatted).toContain('properties.row.type: property row keeps desktop panel inset')
    expect(formatted).toContain('properties.row.type: property row keeps desktop minimum height')
    expect(formatted).toContain('properties.row.type: property label keeps desktop row inset')
    expect(formatted).toContain('properties.row.type: property value keeps desktop right padding')
    expect(formatted).toContain('properties.action.add-property: property action row keeps desktop panel inset')
    expect(formatted).toContain('properties.action.add-property: property action value keeps desktop right padding')
    expect(formatted).toContain('properties.relationship.llm-workflow: relationship row fills the property value width')
  })

  it('accepts native sidebar metrics that match desktop spacing tokens', () => {
    const metrics = latestNativeLayoutMetrics(validNativeDesktopMetrics.flat())

    expect(assertNativeMobileLayoutMetrics(metrics)).toEqual([])
  })

  it('reports native sidebar rows that lose horizontal or vertical padding', () => {
    const metrics = latestNativeLayoutMetrics(invalidNativeDesktopSpacingMetrics.flat())

    const failures = assertNativeMobileLayoutMetrics(metrics)
    const formatted = formatNativeLayoutAssertionFailures(failures)

    expect(formatted).toContain('sidebar.item.inbox: row keeps desktop section inset')
    expect(formatted).toContain('sidebar.item.inbox: row keeps desktop vertical padding')
    expect(formatted).toContain('sidebar.folder.writing: folder content keeps desktop indentation')
    expect(formatted).toContain('sidebar.section.favorites: section title keeps desktop header height')
    expect(formatted).toContain('sidebar.item.personal-journal.row: first row starts exactly after the sidebar section title')
    expect(formatted).toContain('sidebar.item.all-notes: row starts exactly after the previous sidebar row')
    expect(formatted).toContain('sidebar.item.essays.count: count text is vertically centered inside native pill')
    expect(formatted).toContain('sidebar.section.primary: primary section keeps desktop top padding')
    expect(formatted).toContain('sidebar.folderTree.root: folder tree keeps desktop section inset')
    expect(formatted).toContain('sidebar.folder.writing-drafts: metric starts after the previous metric')
    expect(formatted).toContain('noteList.panel: note list keeps desktop column width')
    expect(formatted).toContain('noteList.item.workflow-orchestration.frame: note row surface fills the desktop note-list column')
    expect(formatted).toContain('noteList.item.workflow-orchestration.header: note row content keeps desktop horizontal padding')
    expect(formatted).toContain('noteList.item.workflow-orchestration.header: note row content keeps desktop top padding')
    expect(formatted).toContain('noteList.item.workflow-orchestration.title: note row title keeps desktop line height')
  })

  it('accepts native WYSIWYG editor metrics that match desktop toolbar tokens', () => {
    const metrics = latestNativeLayoutMetrics(wysiwygEditorMetric())

    expect(assertNativeWysiwygEditorLayoutMetrics(metrics)).toEqual([])
  })

  it('reports native WYSIWYG editor metrics that lose toolbar spacing', () => {
    const metrics = latestNativeLayoutMetrics(
      wysiwygEditorMetric({
        actionGap: 0,
        actionSize: 20,
        toolbarHostBottomGap: 18,
        toolbarX: 0,
      }),
    )

    const formatted = formatNativeLayoutAssertionFailures(assertNativeWysiwygEditorLayoutMetrics(metrics))

    expect(formatted).toContain('editor.wysiwyg.toolbarHost: WYSIWYG toolbar stays pinned to the editor bottom')
    expect(formatted).toContain('editor.wysiwyg.toolbar: WYSIWYG toolbar keeps desktop horizontal inset')
    expect(formatted).toContain('editor.wysiwyg.toolbar.action.bold: WYSIWYG toolbar action keeps tablet touch target width')
    expect(formatted).toContain('editor.wysiwyg.toolbar.action.italic: WYSIWYG toolbar action keeps desktop action gap')
  })
})

const validNativeDesktopMetrics = [
  containerMetric({ height: 104, id: 'sidebar.section.primary.container', width: 259.5 }),
  itemMetric('sidebar.item.inbox', { hasCount: true, y: 4 }),
  itemMetric('sidebar.item.all-notes', { hasCount: true, y: 36 }),
  itemMetric('sidebar.item.archive', { hasCount: true, y: 68 }),
  containerMetric({ height: 90, id: 'sidebar.section.favorites.container', width: 259.5, y: 104 }),
  sectionMetric('favorites'),
  itemMetric('sidebar.item.personal-journal', { hasCount: false, y: 30 }),
  itemMetric('sidebar.item.memoria-mvp', { hasCount: false, y: 60 }),
  containerMetric({ height: 72, id: 'sidebar.section.views.container', width: 259.5, y: 194 }),
  sectionMetric('views', 40),
  itemMetric('sidebar.item.view-active-procedures', { hasCount: true, y: 40 }),
  containerMetric({ height: 130, id: 'sidebar.section.types.container', width: 259.5, y: 266 }),
  sectionMetric('types'),
  itemMetric('sidebar.item.essays', { hasCount: true, y: 30 }),
  itemMetric('sidebar.item.procedures', { hasCount: true, y: 62 }),
  itemMetric('sidebar.item.responsibilities', { hasCount: true, y: 94 }),
  containerMetric({ height: 220, id: 'sidebar.section.folders.container', width: 259.5, y: 396 }),
  sectionMetric('folders'),
  countPillMetric('sidebar.item.archive.count'),
  countPillMetric('sidebar.item.view-active-procedures.count'),
  countPillMetric('sidebar.section.types.count', { compact: true }),
  folderTreeRootMetric(30, { height: 190, x: 6 }),
  containerMetric({ height: 90, id: 'sidebar.folder.writing.container' }),
  folderMetric('sidebar.folder.writing', 12),
  containerMetric({ height: 30, id: 'sidebar.folder.writing-essays.container' }),
  folderMetric('sidebar.folder.writing-essays', 37),
  containerMetric({ height: 30, id: 'sidebar.folder.writing-drafts.container', y: 30 }),
  folderMetric('sidebar.folder.writing-drafts', 37),
  containerMetric({ height: 90, id: 'sidebar.folder.memoria.container', y: 90 }),
  folderMetric('sidebar.folder.memoria', 12),
  containerMetric({ height: 30, id: 'sidebar.folder.memoria-mobile-ui.container' }),
  folderMetric('sidebar.folder.memoria-mobile-ui', 37),
  containerMetric({ height: 30, id: 'sidebar.folder.memoria-releases.container', y: 30 }),
  folderMetric('sidebar.folder.memoria-releases', 37),
  noteListPanelMetric(),
  noteListItemMetric('noteList.item.workflow-orchestration', { selected: true, y: 0 }),
  noteListItemMetric('noteList.item.open-source-project', { y: 118 }),
  propertiesPanelMetric(),
  propertyRowMetric('properties.row.type'),
  propertyRowMetric('properties.row.created'),
  propertyRowMetric('properties.row.modified'),
  propertyRowMetric('properties.row.workspace'),
  propertyRowMetric('properties.row.links'),
  propertySectionMetric('properties.section.tags'),
  propertySectionMetric('properties.section.belongs-to'),
  propertyActionMetric('properties.action.add-property'),
  propertyActionMetric('properties.action.add-relationship'),
  relationshipRowMetric('properties.relationship.llm-workflow', 'properties.section.belongs-to'),
]

const invalidNativeDesktopSpacingMetrics = [
  containerMetric({ height: 94, id: 'sidebar.section.primary.container', width: 259.5 }),
  itemMetric('sidebar.item.inbox', { hasCount: true, rowHeight: 22, rowX: 0 }),
  itemMetric('sidebar.item.all-notes', { hasCount: true, y: 10 }),
  itemMetric('sidebar.item.archive', { hasCount: true, y: 64 }),
  containerMetric({ height: 76, id: 'sidebar.section.favorites.container', width: 259.5, y: 80 }),
  sectionMetric('favorites', 18),
  itemMetric('sidebar.item.personal-journal', { hasCount: false, y: 16 }),
  itemMetric('sidebar.item.memoria-mvp', { hasCount: false, y: 46 }),
  containerMetric({ height: 72, id: 'sidebar.section.views.container', width: 259.5, y: 156 }),
  sectionMetric('views', 40),
  itemMetric('sidebar.item.view-active-procedures', { hasCount: true, y: 40 }),
  containerMetric({ height: 130, id: 'sidebar.section.types.container', width: 259.5, y: 220 }),
  sectionMetric('types'),
  itemMetric('sidebar.item.essays', { hasCount: true, y: 30 }),
  itemMetric('sidebar.item.procedures', { hasCount: true, y: 62 }),
  itemMetric('sidebar.item.responsibilities', { hasCount: true, y: 94 }),
  countPillMetric('sidebar.item.essays.count', { textY: 0 }),
  countPillMetric('sidebar.item.archive.count'),
  countPillMetric('sidebar.item.view-active-procedures.count'),
  containerMetric({ height: 180, id: 'sidebar.section.folders.container', width: 259.5, y: 350 }),
  sectionMetric('folders'),
  countPillMetric('sidebar.section.types.count', { compact: true }),
  folderTreeRootMetric(30, { height: 120, x: 0 }),
  containerMetric({ height: 70, id: 'sidebar.folder.writing.container' }),
  folderMetric('sidebar.folder.writing', 0),
  containerMetric({ height: 30, id: 'sidebar.folder.writing-essays.container' }),
  folderMetric('sidebar.folder.writing-essays', 37),
  containerMetric({ height: 30, id: 'sidebar.folder.writing-drafts.container' }),
  folderMetric('sidebar.folder.writing-drafts', 37),
  containerMetric({ height: 40, id: 'sidebar.folder.memoria.container', y: 40 }),
  folderMetric('sidebar.folder.memoria', 12),
  containerMetric({ height: 30, id: 'sidebar.folder.memoria-mobile-ui.container' }),
  folderMetric('sidebar.folder.memoria-mobile-ui', 37),
  containerMetric({ height: 30, id: 'sidebar.folder.memoria-releases.container' }),
  folderMetric('sidebar.folder.memoria-releases', 37),
  noteListPanelMetric({ width: 284 }),
  noteListItemMetric('noteList.item.workflow-orchestration', {
    frameWidth: 284,
    headerX: 0,
    headerY: 2,
    selected: true,
    titleHeight: 14,
  }),
  noteListItemMetric('noteList.item.open-source-project', { frameWidth: 284, headerX: 0, y: 22 }),
]
