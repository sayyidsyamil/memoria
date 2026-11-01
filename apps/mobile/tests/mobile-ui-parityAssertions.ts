import { expect, type Locator, type Page } from '@playwright/test'
import { desktopParityColors } from '../src/ui/desktopParity'
import { mobileMetrics } from '../src/ui/mobileMetrics'

// Desktop tokens remain the source; the approved mobile default scales them to 120%.
const {
  editor: desktopEditorParity, noteItem: desktopNoteItemParity, panel: desktopPanelParity,
  property: desktopPropertyParity, relationship: desktopRelationshipParity,
  sidebar: desktopSidebarParity, toolbar: desktopToolbarParity, toolbarAction: desktopToolbarActionParity,
} = mobileMetrics[1.2]

const layoutTolerance = 1.5

type CssQuery = {
  locator: Locator
  property: string
}

type CssExpectation = CssQuery & {
  expected: string
}

type LayoutExpectation = {
  actual: number
  expected: number
  message: string
}

type ColorNormalizationRequest = {
  color: string
  page: Page
}

export async function assertTabletDesktopParity(page: Page) {
  await assertPanelChromeParity(page)
  await assertNoteListParity(page)
  await assertSidebarParity(page)
  await assertPropertiesParity(page)
  await assertEditorParity(page)
  await assertToolbarActionParity(page)
  await assertSidebarUtilities(page)
}

export async function assertSidebarRuntimeLayoutProbe(page: Page) {
  await page.waitForFunction(() => {
    const target = globalThis as { __MEMORIA_MOBILE_LAYOUT_METRICS__?: Record<string, unknown> }
    return Boolean(target.__MEMORIA_MOBILE_LAYOUT_METRICS__?.['sidebar.item.inbox.row'])
  })

  const metrics = await page.evaluate(() => {
    const target = globalThis as { __MEMORIA_MOBILE_LAYOUT_METRICS__?: Record<string, LayoutMetric> }
    return target.__MEMORIA_MOBILE_LAYOUT_METRICS__ ?? {}
  })

  for (const id of ['sidebar.item.inbox', 'sidebar.item.all-notes', 'sidebar.item.archive', 'sidebar.item.view-active-procedures', 'sidebar.item.essays', 'sidebar.item.procedures', 'sidebar.item.responsibilities']) {
    assertSidebarItemLayout(metrics, id, desktopSidebarParity.itemPadding.withCount)
  }

  for (const id of ['sidebar.item.personal-journal', 'sidebar.item.memoria-mvp']) {
    assertSidebarItemLayout(metrics, id, desktopSidebarParity.itemPadding.regular)
  }

  assertSidebarRowsAreContiguous(metrics, ['sidebar.item.inbox', 'sidebar.item.all-notes', 'sidebar.item.archive'])
  assertSidebarRowsAreContiguous(metrics, ['sidebar.item.personal-journal', 'sidebar.item.memoria-mvp'])
  assertSidebarRowsAreContiguous(metrics, ['sidebar.item.essays', 'sidebar.item.procedures', 'sidebar.item.responsibilities'])

  for (const id of ['sidebar.folder.writing', 'sidebar.folder.memoria']) {
    assertFolderLayout(metrics, id, desktopSidebarParity.folderRowContentInset)
  }

  for (const id of ['sidebar.folder.writing-essays', 'sidebar.folder.writing-drafts', 'sidebar.folder.memoria-mobile-ui', 'sidebar.folder.memoria-releases']) {
    assertFolderLayout(metrics, id, desktopSidebarParity.folderRowContentInset + desktopSidebarParity.folderRowIndent)
  }
}

async function assertPanelChromeParity(page: Page) {
  await expectCssValue({ locator: page.getByTestId('workspace-sidebar-panel'), property: 'width', expected: `${desktopPanelParity.sidebarWidth}px` })
  await expectCssValue({ locator: page.getByTestId('note-list-panel'), property: 'width', expected: `${desktopPanelParity.noteListWidth}px` })
  await expectCssValue({ locator: page.getByTestId('properties-panel'), property: 'width', expected: `${desktopPanelParity.inspectorWidth}px` })

  for (const toolbar of [
    page.getByTestId('sidebar-toolbar'),
    page.getByTestId('note-list-toolbar'),
    page.getByTestId('editor-toolbar'),
    page.getByTestId('properties-toolbar'),
  ]) {
  await expect(toolbar).toBeVisible()
    await expectCssValue({ locator: toolbar, property: 'min-height', expected: `${desktopPanelParity.toolbarHeight}px` })
    await expectCssValue({ locator: toolbar, property: 'padding-left', expected: `${desktopToolbarParity.paddingHorizontal}px` })
    await expectCssValue({ locator: toolbar, property: 'border-bottom-color', expected: await cssColor({ page, color: desktopParityColors.borderDefault }) })
  }

  await expectCssValue({ locator: page.getByTestId('note-list-toolbar-title'), property: 'font-size', expected: `${desktopToolbarParity.titleFontSize}px` })
  await expectCssValue({ locator: page.getByTestId('properties-toolbar-title'), property: 'font-size', expected: `${desktopToolbarParity.inspectorTitleFontSize}px` })
  await expectCssValue({ locator: page.getByTestId('properties-toolbar-title'), property: 'color', expected: await cssColor({ page, color: desktopParityColors.textSecondary }) })
}

async function assertNoteListParity(page: Page) {
  const noteListPanel = page.getByTestId('note-list-panel')
  const selectedRow = page.getByTestId('note-row-workflow-orchestration')
  const nextRow = page.getByTestId('note-row-open-source-project')

  await expect(noteListPanel).toBeVisible()
  await expect(selectedRow).toBeVisible()
  await expect(nextRow).toBeVisible()

  const panelBox = await requiredBox(noteListPanel)
  const selectedBox = await requiredBox(selectedRow)
  const nextBox = await requiredBox(nextRow)

  expectClose({ actual: selectedBox.x, expected: panelBox.x, message: 'selected note row starts at the note-list panel edge' })
  expectClose({ actual: selectedBox.width, expected: panelBox.width, message: 'selected note row spans the full note-list panel' })
  expectClose({ actual: nextBox.y, expected: selectedBox.y + selectedBox.height, message: 'note rows are separated by the desktop border, not by wrapper margins' })

  await expectCssValue({ locator: selectedRow, property: 'background-color', expected: await cssColor({ page, color: desktopParityColors.accentGreenLight }) })
  await expectCssValue({ locator: selectedRow, property: 'border-left-width', expected: '0px' })
  await expectCssValue({ locator: selectedRow, property: 'border-bottom-color', expected: await cssColor({ page, color: desktopParityColors.borderDefault }) })
  await expectCssValue({ locator: selectedRow, property: 'border-top-left-radius', expected: '0px' })
  await expectCssValue({ locator: selectedRow, property: 'margin-bottom', expected: '0px' })
  await expectChildCssValue({ locator: selectedRow, property: 'padding-top', expected: `${desktopNoteItemParity.padding.top}px` })
  await expectChildCssValue({ locator: selectedRow, property: 'padding-left', expected: `${desktopNoteItemParity.padding.left}px` })
  await expectChildCssValue({ locator: selectedRow, property: 'padding-right', expected: `${desktopNoteItemParity.padding.right}px` })
}

async function assertSidebarParity(page: Page) {
  const primarySection = page.getByTestId('sidebar-section-primary')
  const favoritesTitle = page.getByTestId('sidebar-section-title-favorites')
  const favoritesTitleText = page.getByTestId('sidebar-section-title-text-favorites')
  const typesCount = page.getByTestId('sidebar-item-essays-count')
  const inboxItem = page.getByTestId('sidebar-item-inbox')

  await expect(primarySection).toBeVisible()
  await expect(favoritesTitle).toBeVisible()
  await expect(inboxItem).toBeVisible()
  await expect(page.getByTestId('sidebar-section-count-types')).toHaveCount(0)

  await expectCssValue({ locator: primarySection, property: 'padding-top', expected: `${desktopSidebarParity.topNavPadding.top}px` })
  await expectCssValue({ locator: primarySection, property: 'padding-left', expected: `${desktopSidebarParity.topNavPadding.left}px` })
  await expectCssValue({ locator: primarySection, property: 'border-bottom-color', expected: await cssColor({ page, color: desktopParityColors.borderDefault }) })
  await expectCssValue({ locator: favoritesTitle, property: 'padding-top', expected: `${desktopSidebarParity.groupHeaderPadding.withCount.top}px` })
  await expectCssValue({ locator: favoritesTitle, property: 'padding-left', expected: `${desktopSidebarParity.groupHeaderPadding.withCount.left}px` })
  await expectCssValue({ locator: favoritesTitleText, property: 'color', expected: await cssColor({ page, color: desktopParityColors.textSecondary }) })
  await expectCssValue({ locator: typesCount, property: 'font-size', expected: `${desktopSidebarParity.countPillTextSize}px` })
  await expectCssValue({ locator: typesCount, property: 'height', expected: `${desktopSidebarParity.countPillHeight}px` })
  await expectCssValue({ locator: typesCount, property: 'border-radius', expected: `${desktopSidebarParity.countPillRadius}px` })
  await expectCssValue({ locator: inboxItem, property: 'background-color', expected: await cssColor({ page, color: desktopParityColors.accentBlueLight }) })
}

async function assertPropertiesParity(page: Page) {
  const propertiesPanel = page.getByTestId('properties-panel')
  const typeRow = page.getByTestId('property-row-type')
  const typeLabel = page.getByTestId('property-row-type-label')
  const tagsWrap = page.getByTestId('property-tags-wrap')
  const belongsToSection = page.getByTestId('property-section-belongsTo')
  const relationshipRow = page.getByTestId('relationship-row-llm-workflow')
  const relationshipText = page.getByTestId('relationship-row-llm-workflow-text')
  const addPropertyRow = page.getByTestId('property-action-add-property')

  await expect(propertiesPanel).toBeVisible()
  await expect(typeRow).toBeVisible()
  await expect(belongsToSection).toBeVisible()

  await expectCssValue({ locator: typeRow, property: 'min-height', expected: `${desktopPropertyParity.rowMinHeight}px` })
  await expectCssValue({ locator: typeRow, property: 'padding-left', expected: `${desktopPropertyParity.rowPaddingHorizontal}px` })
  await expectCssValue({ locator: typeLabel, property: 'font-size', expected: `${desktopPropertyParity.labelTextSize}px` })
  await expectCssValue({ locator: typeLabel, property: 'color', expected: await cssColor({ page, color: desktopParityColors.textSecondary }) })
  await expectCssValue({ locator: tagsWrap, property: 'flex-wrap', expected: 'wrap' })
  await expectCssValue({ locator: relationshipRow, property: 'border-radius', expected: `${desktopRelationshipParity.rowRadius}px` })
  await expectCssValue({ locator: relationshipRow, property: 'padding-left', expected: `${desktopRelationshipParity.rowPaddingHorizontal}px` })
  await expectCssValue({ locator: relationshipRow, property: 'padding-top', expected: `${desktopRelationshipParity.rowPaddingVertical}px` })
  await expectCssValue({ locator: relationshipText, property: 'font-size', expected: `${desktopRelationshipParity.textFontSize}px` })
  await expectCssValue({ locator: relationshipText, property: 'font-weight', expected: desktopRelationshipParity.textFontWeight })
  await expectCssValue({ locator: relationshipText, property: 'color', expected: await cssColor({ page, color: desktopParityColors.accentGreen }) })
  await expectCssValue({ locator: addPropertyRow, property: 'min-height', expected: `${desktopPropertyParity.rowMinHeight}px` })
  await expectCssValue({ locator: addPropertyRow, property: 'border-radius', expected: `${desktopPropertyParity.actionRowRadius}px` })
}

async function assertEditorParity(page: Page) {
  const sourceInput = page.getByTestId('editor-markdown-input')
  if (await sourceInput.isVisible().catch(() => false)) {
    await assertSourceEditorParity(page, sourceInput)
    return
  }

  const titleBlock = page.getByTestId('editor-title-block')
  const title = page.getByTestId('editor-title')
  const paragraph = page.getByTestId('editor-paragraph').first()
  const heading = page.getByTestId('editor-heading-2')
  const quote = page.getByTestId('editor-quote')
  const quoteText = page.getByTestId('editor-quote-text')
  const table = page.getByTestId('editor-table')

  await expect(titleBlock).toBeVisible()
  await expect(title).toBeVisible()
  await expect(table).toBeVisible()

  await expectCssValue({ locator: title, property: 'font-size', expected: `${desktopEditorParity.h1FontSize}px` })
  await expectCssValue({ locator: title, property: 'font-weight', expected: '700' })
  await expectCssValue({ locator: title, property: 'line-height', expected: `${desktopEditorParity.h1LineHeight}px` })
  await expectCssValue({ locator: titleBlock, property: 'padding-bottom', expected: `${desktopEditorParity.h1PaddingBottom}px` })
  await expectCssValue({ locator: titleBlock, property: 'margin-bottom', expected: `${desktopEditorParity.h1MarginBottom}px` })
  await expectCssValue({ locator: titleBlock, property: 'border-bottom-color', expected: await cssColor({ page, color: desktopParityColors.borderDefault }) })
  await expectCssValue({ locator: paragraph, property: 'font-size', expected: `${desktopEditorParity.bodyFontSize}px` })
  await expectCssValue({ locator: paragraph, property: 'line-height', expected: `${desktopEditorParity.bodyLineHeight}px` })
  await expectCssValue({ locator: heading, property: 'font-size', expected: `${desktopEditorParity.h2FontSize}px` })
  await expectCssValue({ locator: heading, property: 'font-weight', expected: '600' })
  await expectCssValue({ locator: quote, property: 'border-left-width', expected: '3px' })
  await expectCssValue({ locator: quote, property: 'padding-left', expected: `${desktopEditorParity.quotePaddingLeft}px` })
  await expectCssValue({ locator: quoteText, property: 'font-style', expected: 'italic' })
}

async function assertSourceEditorParity(page: Page, sourceInput: Locator) {
  await expect(page.getByTestId('editor-markdown-form')).toBeVisible()
  await expect(page.getByTestId('editor-formatting-toolbar')).toBeVisible()
  await expect(sourceInput).toBeVisible()
  await expect(sourceInput).toHaveValue(/# Workflow Orchestration Essay/u)

  await expectCssValue({ locator: sourceInput, property: 'font-size', expected: `${desktopEditorParity.bodyFontSize}px` })
  await expectCssValue({ locator: sourceInput, property: 'line-height', expected: `${desktopEditorParity.bodyLineHeight}px` })
  await expectCssValue({ locator: sourceInput, property: 'padding-left', expected: '12px' })
  await expectCssValue({ locator: sourceInput, property: 'padding-top', expected: '12px' })
}

async function assertSidebarUtilities(page: Page) {
  await expect(page.getByTestId('sync-status-bar')).toHaveCount(0)
  const command = page.getByTestId('sidebar-command-palette-action')
  const settings = page.getByTestId('open-mobile-settings')
  for (const button of [command, settings]) {
    await expect(button).toBeVisible()
    await expectCssValue({ locator: button, property: 'height', expected: '48px' })
    await expectCssValue({ locator: button, property: 'width', expected: '48px' })
    await expectCssValue({ locator: button, property: 'border-radius', expected: '24px' })
  }
  const commandBox = await requiredBox(command)
  const settingsBox = await requiredBox(settings)
  expect(commandBox.x + commandBox.width).toBeLessThan(settingsBox.x)
  await expect(page.getByTestId('sidebar-vault-picker')).toBeVisible()
}

async function assertToolbarActionParity(page: Page) {
  const actionButtons = [
    page.getByTestId('note-list-search-action'),
    page.getByTestId('editor-favorite-action'),
    page.getByTestId('editor-more-action'),
  ]

  for (const button of actionButtons) {
    await expect(button).toBeVisible()
    await expectCssValue({ locator: button, property: 'height', expected: `${desktopToolbarActionParity.iconButtonSize}px` })
    await expectCssValue({ locator: button, property: 'width', expected: `${desktopToolbarActionParity.iconButtonSize}px` })
    await expectCssValue({ locator: button, property: 'border-radius', expected: `${desktopToolbarActionParity.borderRadius}px` })
    await expectCssValue({ locator: button, property: 'background-color', expected: 'rgba(0, 0, 0, 0)' })
  }
  await expect(page.getByTestId('sidebar-collapse-action')).toHaveCount(0)
  const create = page.getByTestId('note-list-create-action')
  const createSize = mobileMetrics[1.2].size(48)
  await expectCssValue({ locator: create, property: 'width', expected: `${createSize}px` })
  await expectCssValue({ locator: create, property: 'height', expected: `${createSize}px` })
  await expectCssValue({ locator: create, property: 'border-radius', expected: `${createSize / 2}px` })
  await expect(page.getByTestId('note-list-toolbar').getByTestId('note-list-create-action')).toHaveCount(0)
}

async function cssColor({ color, page }: ColorNormalizationRequest) {
  return page.evaluate((value) => {
    const node = document.createElement('div')
    node.style.color = value
    document.body.append(node)
    const computed = getComputedStyle(node).color
    node.remove()
    return computed
  }, color)
}

async function cssValue({ locator, property }: CssQuery) {
  return locator.evaluate((element, cssProperty) => getComputedStyle(element).getPropertyValue(cssProperty), property)
}

async function childCssValue({ locator, property }: CssQuery) {
  return locator.evaluate((element, cssProperty) => {
    const child = element.firstElementChild
    if (!child) throw new Error('Expected parity surface to have a child content element.')
    return getComputedStyle(child).getPropertyValue(cssProperty)
  }, property)
}

async function expectCssValue(expectation: CssExpectation) {
  expectCss(await cssValue(expectation), expectation.expected)
}

async function expectChildCssValue(expectation: CssExpectation) {
  expectCss(await childCssValue(expectation), expectation.expected)
}

function expectCss(actual: string, expected: string) {
  if (expected.endsWith('px')) {
    // Chromium quantizes fractional layout sizes to 1/64 CSS pixel.
    expect(Math.abs(Number.parseFloat(actual) - Number.parseFloat(expected))).toBeLessThanOrEqual(1 / 64)
  } else {
    expect(actual).toBe(expected)
  }
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Expected element to have a bounding box.')
  return box
}

function expectClose({ actual, expected, message }: LayoutExpectation) {
  expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(layoutTolerance)
}

type LayoutMetric = {
  height: number
  width: number
  x: number
  y: number
}

type SidebarPadding = {
  bottom: number
  left: number
  right: number
  top: number
}

function assertSidebarItemLayout(metrics: Record<string, LayoutMetric>, id: string, padding: SidebarPadding) {
  const row = requiredMetric(metrics, `${id}.row`)
  const content = requiredMetric(metrics, `${id}.content`)

  expectClose({ actual: row.x, expected: desktopSidebarParity.sectionHorizontalPadding, message: `${id} keeps desktop section inset` })
  expectClose({ actual: content.x, expected: padding.left, message: `${id} has desktop left padding` })
  expectClose({ actual: row.width - content.x - content.width, expected: padding.right, message: `${id} has desktop right padding` })
  expectClose({ actual: row.height - content.height, expected: padding.top + padding.bottom, message: `${id} has desktop vertical padding` })
}

function assertSidebarRowsAreContiguous(metrics: Record<string, LayoutMetric>, ids: string[]) {
  for (let index = 1; index < ids.length; index += 1) {
    const previous = requiredMetric(metrics, `${ids[index - 1]}.row`)
    const current = requiredMetric(metrics, `${ids[index]}.row`)

    expectClose({
      actual: current.y - previous.y - previous.height,
      expected: 0,
      message: `${ids[index]} starts exactly after ${ids[index - 1]}`,
    })
  }
}

function assertFolderLayout(metrics: Record<string, LayoutMetric>, id: string, expectedLeftInset: number) {
  const row = requiredMetric(metrics, `${id}.row`)
  const content = requiredMetric(metrics, `${id}.content`)

  expectClose({ actual: content.x, expected: expectedLeftInset, message: `${id} has desktop folder indentation` })
  expect(row.height, `${id} has a non-collapsed row hit area`).toBeGreaterThanOrEqual(28)
}

function requiredMetric(metrics: Record<string, LayoutMetric>, id: string) {
  const metric = metrics[id]
  if (!metric) throw new Error(`Missing layout metric: ${id}`)

  return metric
}
