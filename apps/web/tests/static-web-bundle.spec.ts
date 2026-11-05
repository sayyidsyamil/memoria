import { writeFileSync } from 'node:fs'
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'

// TOL-3: the static web bundle (apps/web/dist, no Tauri runtime) must load, list
// notes, open one and accept BlockNote typing in Chromium and WebKit, on
// desktop and on iPhone/iPad emulation. Layout measurements are attached to the
// report so mobile regressions/improvements are visible without a device.

const NOTE_TITLE = 'Build Laputa App'
const TYPED_TEXT = 'Typed in the static web build'

interface PaneBox {
  left: number
  right: number
  width: number
}

interface LayoutReport {
  editor: PaneBox | null
  editorVisibleFraction: number
  noteList: PaneBox | null
  project: string
  viewportWidth: number
}

async function paneBox(locator: Locator): Promise<PaneBox | null> {
  const box = await locator.boundingBox()
  if (!box) return null
  return { left: Math.round(box.x), right: Math.round(box.x + box.width), width: Math.round(box.width) }
}

function visibleFraction(box: PaneBox | null, viewportWidth: number): number {
  if (!box || box.width === 0) return 0
  const visible = Math.min(box.right, viewportWidth) - Math.max(box.left, 0)
  return Math.max(0, Math.round((visible / box.width) * 100) / 100)
}

async function layoutReport(page: Page, testInfo: TestInfo): Promise<LayoutReport> {
  const viewportWidth = page.viewportSize()?.width ?? 0
  const editor = await paneBox(page.locator('.bn-editor').first())
  return {
    editor,
    editorVisibleFraction: visibleFraction(editor, viewportWidth),
    noteList: await paneBox(page.getByTestId('note-list-container')),
    project: testInfo.project.name,
    viewportWidth,
  }
}

async function openApp(page: Page): Promise<string[]> {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // The note list shows on every layout; the phone hides the sidebar (TOL-193).
  await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 20_000 })
  return pageErrors
}

async function openNote(page: Page): Promise<Locator> {
  const noteList = page.getByTestId('note-list-container')
  await expect(noteList.getByText(NOTE_TITLE, { exact: true })).toBeVisible({ timeout: 15_000 })
  await noteList.getByText(NOTE_TITLE, { exact: true }).click()
  const editor = page.locator('.bn-editor').first()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  await expect(editor).toContainText('bold text', { timeout: 15_000 })
  return editor
}

test.describe('static web bundle', () => {
  test('runs without a Tauri runtime and shows the note list', async ({ page }) => {
    const pageErrors = await openApp(page)

    expect(await page.evaluate(() => '__TAURI__' in window || '__TAURI_INTERNALS__' in window)).toBe(false)
    await expect(page.getByTestId('note-list-container').getByText(NOTE_TITLE, { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('opens a note and accepts BlockNote typing', async ({ page }, testInfo) => {
    const pageErrors = await openApp(page)
    const editor = await openNote(page)

    const report = await layoutReport(page, testInfo)
    const layoutPath = testInfo.outputPath('layout.json')
    writeFileSync(layoutPath, JSON.stringify(report, null, 2))
    await testInfo.attach('layout.json', { path: layoutPath, contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('note-open.png') })

    await editor.locator('p, [data-content-type="paragraph"]').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(` ${TYPED_TEXT}`)

    await expect(editor).toContainText(TYPED_TEXT)
    await page.screenshot({ path: testInfo.outputPath('note-typed.png') })
    expect(pageErrors).toEqual([])
  })
})
