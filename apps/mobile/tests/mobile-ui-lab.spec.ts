import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { assertDesktopParitySources } from './mobile-ui-desktopParitySources'
import { assertSidebarRuntimeLayoutProbe, assertTabletDesktopParity } from './mobile-ui-parityAssertions'
import { installLocalVaultSnapshot, localVaultPath } from './local-vault-snapshot-loader'
import { dragPanel, toggleTabletProperties } from './mobile-panel-navigation'

type ScreenshotRecord = {
  description: string
  path: string
  project: string
  viewport: { height: number; width: number } | null
}

const screenshotDir = process.env.MOBILE_QA_SCREENSHOT_DIR ?? '/tmp/memoria-mobile-ui-screenshots'

const tabletScenarioStates = [
  {
    description: 'empty-inbox',
    expectedText: 'All notes are organized',
    scenario: 'empty-inbox',
  },
  {
    description: 'long-title',
    expectedText: 'A Very Long Note Title That Should Stay Readable',
    scenario: 'long-title',
  },
  {
    description: 'property-heavy',
    expectedText: 'Depends on',
    scenario: 'property-heavy',
  },
  {
    description: 'folder-tree',
    expectedText: 'Research Backlog',
    landscapeOnly: true,
    scenario: 'folder-tree',
  },
]

const phoneStates = [
  {
    description: 'sidebar-open',
    expectedText: 'Memoria',
    query: '?phoneState=sidebar',
  },
  {
    description: 'editor-open',
    expectedText: 'Workflow Orchestration Essay',
    query: '?phoneState=editor',
  },
]

const phoneScenarioStates = [
  {
    description: 'long-title-list',
    expectedText: 'A Very Long Note Title That Should Stay Readable',
    query: '?scenario=long-title',
  },
  {
    description: 'property-heavy-editor',
    expectedText: 'Mobile UI Parity Review',
    query: '?scenario=property-heavy&phoneState=editor',
  },
]

const tabletProjectNames = ['tablet-landscape', 'tablet-portrait'] as const
const currentScreenshotNames = new Set([
  ...tabletProjectNames.flatMap((projectName) => [
    `${projectName}-initial.png`,
    `${projectName}-selected-open-source-project.png`,
    ...tabletScenarioStates
      .filter((scenarioState) => projectName === 'tablet-landscape' || !scenarioState.landscapeOnly)
      .map((scenarioState) => `${projectName}-${scenarioState.description}.png`),
  ]),
  'phone-portrait-initial.png',
  ...phoneStates.map((phoneState) => `phone-portrait-${phoneState.description}.png`),
  ...phoneScenarioStates.map((phoneState) => `phone-portrait-${phoneState.description}.png`),
  ...(localVaultPath ? [
    'tablet-landscape-local-vault.png',
    'tablet-portrait-local-vault.png',
    'phone-portrait-local-vault.png',
  ] : []),
])

async function recordScreenshot(record: ScreenshotRecord) {
  const manifestPath = join(screenshotDir, 'manifest.json')
  let existing: ScreenshotRecord[] = []
  try {
    existing = JSON.parse(await readFile(manifestPath, 'utf8')) as ScreenshotRecord[]
  } catch {
    existing = []
  }

  const next = existing.filter((item) => currentScreenshotNames.has(basename(item.path)) && item.path !== record.path)
  next.push(record)
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
}

async function captureUiState({
  description,
  page,
  projectName,
}: {
  description: string
  page: Page
  projectName: string
}) {
  await mkdir(screenshotDir, { recursive: true })
  const screenshotPath = join(screenshotDir, `${projectName}-${description}.png`)
  await page.screenshot({ fullPage: true, path: screenshotPath })
  await recordScreenshot({
    description,
    path: screenshotPath,
    project: projectName,
    viewport: page.viewportSize(),
  })
}

test.describe('mobile UI lab screenshots', () => {
  test('captures the initial workspace reference state', async ({ page }, testInfo) => {
    await page.goto('/')

    expect(new URL(page.url()).searchParams.get('source')).toBe('fixture')
    await expect(page.getByText('Inbox').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Workflow Orchestration Essay' })).toBeVisible()

    if (testInfo.project.name !== 'phone-portrait') {
      await expect(page.getByText('Properties', { exact: true })).toBeVisible()
    }

    await captureUiState({
      description: 'initial',
      page,
      projectName: testInfo.project.name,
    })
  })

  test('captures a selected-note state on tablet layouts', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone-portrait', 'Phone layout captures the scrollable tablet preview only.')

    await page.goto('/?editorMode=read')

    const openSourceProjectNote = page.getByText('How I Run an Open Source Project').first()

    await expect(openSourceProjectNote).toBeVisible()
    await openSourceProjectNote.click()
    await expect(openSourceProjectNote).toBeVisible()
    await expect(page.getByText('Procedure').last()).toBeVisible()

    await captureUiState({
      description: 'selected-open-source-project',
      page,
      projectName: testInfo.project.name,
    })
  })

  test('navigates tablet sidebar sections and folders', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Sidebar navigation is exercised in the full-width tablet layout.')

    await page.goto('/')

    await page.getByTestId('sidebar-item-procedures').click()
    await expect(page.getByText('How I Run an Open Source Project').first()).toBeVisible()
    await expect(page.getByText('Procedure').last()).toBeVisible()

    await page.getByRole('button', { name: 'Releases' }).click()
    await expect(page.getByText('v2026-05-02').first()).toBeVisible()
    await expect(page.getByText('Release cleanup date, bug fixes, and mobile planning notes.').first()).toBeVisible()

    await page.getByRole('button', { name: 'Inbox' }).click()
    await expect(page.getByText('Workflow Orchestration Essay').first()).toBeVisible()
  })

  test('enforces tablet desktop-parity visual invariants', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Desktop parity assertions use the full-width tablet reference layout.')

    await page.goto('/?editorMode=read')

    await assertTabletDesktopParity(page)
  })

  test('enforces measured sidebar row layout invariants', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Sidebar row metrics use the full-width tablet reference layout.')

    await page.goto('/?layoutProbe=1')

    await assertSidebarRuntimeLayoutProbe(page)
  })

  test('keeps mobile parity constants synced with desktop token sources', async ({ browserName }, testInfo) => {
    void browserName
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Desktop source drift only needs one project run.')

    await assertDesktopParitySources()
  })

  test('matches the tablet landscape pixel baseline', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Pixel baseline is scoped to the primary iPad reference layout.')

    await page.goto('/?editorMode=read')

    await expect(page).toHaveScreenshot('tablet-landscape-parity-baseline.png', {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.002,
    })
  })

  test('drags tablet panels from their content surfaces', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Tablet chrome gestures are exercised in the full-width tablet layout.')

    await page.goto('/?tabletPanels=all')

    const viewportWidth = requiredViewportWidth(page)
    await toggleTabletProperties(page)
    await dragPanel(page, { x: 580, y: 30 }, { x: 20, y: 30 })
    await page.waitForTimeout(500)
    const editorOnlyBox = await requiredBox(page, 'editor-panel')
    expect(editorOnlyBox.x).toBeLessThanOrEqual(1)

    await dragPanel(page, { x: 12, y: 30 }, { x: 650, y: 30 })
    await waitForPanelToSettle(page, 'workspace-sidebar-panel')
    await waitForPanelToSettle(page, 'tablet-properties-panel-host')
    const restoredSidebar = await requiredBox(page, 'workspace-sidebar-panel')
    expect(restoredSidebar.x).toBeGreaterThanOrEqual(0)

    const hiddenProperties = await requiredBox(page, 'tablet-properties-panel-host')
    expect(hiddenProperties.x).toBeGreaterThan(viewportWidth - hiddenProperties.width + 1)

  })

  for (const scenarioState of tabletScenarioStates) {
    test(`captures the ${scenarioState.description} state on tablet layouts`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'phone-portrait', 'Phone layout captures the scrollable tablet preview only.')
      test.skip(Boolean(scenarioState.landscapeOnly) && testInfo.project.name !== 'tablet-landscape', 'Sidebar density is visible only in tablet landscape.')

      await page.goto(`/?scenario=${scenarioState.scenario}`)

      await expect(page.getByText(scenarioState.expectedText).first()).toBeVisible()

      await captureUiState({
        description: scenarioState.description,
        page,
        projectName: testInfo.project.name,
      })
    })
  }

  for (const phoneState of phoneStates) {
    test(`captures the phone ${phoneState.description} state`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone-portrait', 'Phone shell states are captured only in the phone viewport.')

      await page.goto(phoneState.query)

      await expect(page.getByText(phoneState.expectedText).first()).toBeVisible()

      await captureUiState({
        description: phoneState.description,
        page,
        projectName: testInfo.project.name,
      })
    })
  }

  for (const phoneState of phoneScenarioStates) {
    test(`captures the phone ${phoneState.description} scenario`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone-portrait', 'Phone shell scenarios are captured only in the phone viewport.')

      await page.goto(phoneState.query)

      await expect(page.getByText(phoneState.expectedText).first()).toBeVisible()

      await captureUiState({
        description: phoneState.description,
        page,
        projectName: testInfo.project.name,
      })
    })
  }

  test('captures an injected local vault read-only state', async ({ page }, testInfo) => {
    const state = await installLocalVaultSnapshot(page)
    test.skip(!state, `Local vault path is not readable: ${localVaultPath}`)
    if (!state) return

    await page.goto('/?source=host-vault')

    await expect(page.getByText(state.snapshot.notes[0]?.title ?? '').first()).toBeVisible()

    await captureUiState({
      description: 'local-vault',
      page,
      projectName: testInfo.project.name,
    })
  })
})

async function requiredBox(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`Cannot measure missing ${testId}.`)
  return box
}

async function waitForPanelToSettle(page: Page, testId: string) {
  await expect.poll(async () => {
    const first = await requiredBox(page, testId)
    await page.waitForTimeout(100)
    const second = await requiredBox(page, testId)
    return Math.abs(first.x - second.x) < 1
  }).toBe(true)
}

function requiredViewportWidth(page: Page) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Expected viewport for tablet gesture test.')
  return viewport.width
}
