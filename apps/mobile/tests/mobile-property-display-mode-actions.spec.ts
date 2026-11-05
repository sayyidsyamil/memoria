import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import { HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY } from '../src/workspace/readOnlyWorkspaceRepository'

test.describe('mobile property display mode action parity', () => {
  test('opens type-derived property placeholders with persisted desktop display modes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Property display-mode placeholder coverage uses the full-width tablet inspector.')

    await installPropertyDisplayModeSnapshot(page)
    await page.goto('/?source=host-vault')

    await page.getByTestId('property-placeholder-type-derived-priority').click()
    await expect(page.getByTestId('workspace-action-sheet-addProperty')).toBeVisible()
    await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('Priority')
    await expect(page.getByTestId('workspace-property-kind-status')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('workspace-property-status-picker')).toBeVisible()
  })
})

async function installPropertyDisplayModeSnapshot(page: Page) {
  const snapshot = {
    ...workspaceScenarioForId('default'),
    vaultConfig: {
      propertyDisplayModes: {
        Priority: 'status',
      },
    },
  }

  await page.addInitScript(
    ({ globalKey, snapshot }) => {
      Reflect.set(window, globalKey, snapshot)
    },
    {
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      snapshot,
    },
  )
}
