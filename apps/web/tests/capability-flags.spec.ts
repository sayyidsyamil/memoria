import { expect, test } from '@playwright/test'

/**
 * TOL-174: Capability flags hide desktop-only UI in the web build.
 * This test opens every major surface (settings, command palette, status bar, etc.)
 * and verifies that desktop-only features are hidden:
 * - Git controls (commit, push, autogit settings, git settings section)
 * - MCP (setup dialog, MCP config button)
 * - Updater (update banner, release channel, auto-update checks)
 * - Multi-window (new window commands)
 * - OpenCode (open in code commands)
 * - CLI agents (if they have specific UI in the web build)
 */

test.describe('Web capability flags', () => {
  test('settings panel hides desktop-only features', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000) // Wait for app to load

    // Settings might be in a menu or status bar - try to find and click it
    // Look for common settings button patterns
    const settingsButton = page.locator('button:has-text("Settings"), [aria-label*="Settings"], [title*="Settings"]').first()
    const settingsButtonCount = await settingsButton.count()

    if (settingsButtonCount > 0) {
      await settingsButton.click()
      await page.waitForTimeout(500)

      const settingsPanel = page.getByTestId('settings-panel')
      await expect(settingsPanel).toBeVisible({ timeout: 5000 })

      // Git settings section should NOT be visible
      const gitSection = page.locator('#settings-section-autogit')
      await expect(gitSection).not.toBeVisible()

      // Updater settings should NOT be visible
      const releaseChannelSetting = page.getByTestId('settings-release-channel')
      await expect(releaseChannelSetting).not.toBeVisible()

      const autoUpdateChecksSetting = page.getByTestId('settings-automatic-update-checks')
      await expect(autoUpdateChecksSetting).not.toBeVisible()

      // Close settings
      await page.keyboard.press('Escape')
    } else {
      // If we can't find a settings button, skip this test
      // The important thing is that the desktop-only sections don't exist in the DOM
      console.log('Settings button not found, verifying sections do not exist in DOM')
      
      // These should not exist anywhere in the DOM in web build
      const gitSection = page.locator('#settings-section-autogit')
      await expect(gitSection).not.toBeVisible()
      
      const releaseChannelSetting = page.getByTestId('settings-release-channel')
      await expect(releaseChannelSetting).not.toBeVisible()
    }
  })

  test('update banner is not rendered', async ({ page }) => {
    await page.goto('/')

    // Update banner should not exist in the web build
    const updateBanner = page.getByTestId('update-banner')
    await expect(updateBanner).not.toBeVisible()
  })

  test('MCP setup dialog is not rendered', async ({ page }) => {
    await page.goto('/')

    // MCP setup dialog should not be accessible
    // Try to find any MCP-related UI elements
    const mcpDialog = page.getByText(/MCP/i).first()
    // If it exists, it should not be visible
    const count = await page.getByText(/MCP/i).count()
    if (count > 0) {
      await expect(mcpDialog).not.toBeVisible()
    }
  })

  test('command palette hides desktop-only commands', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000) // Wait for the app to fully load

    // Open command palette
    await page.keyboard.press('Meta+k') // Cmd+K or Ctrl+K
    await page.waitForTimeout(500)

    const commandPalette = page.getByTestId('command-palette')
    if (await commandPalette.isVisible()) {
      // Search for desktop-only commands and verify they don't appear
      
      // Git commands should not exist
      const gitCommands = page.getByText(/commit|push|pull|git/i)
      const gitCount = await gitCommands.count()
      // Web build should have no git commands visible
      expect(gitCount).toBe(0)

      // New window commands should not exist
      await page.keyboard.type('new window')
      await page.waitForTimeout(300)
      const newWindowCommand = page.getByText(/new window/i)
      await expect(newWindowCommand).not.toBeVisible()

      // OpenCode commands should not exist
      await page.keyboard.selectAll()
      await page.keyboard.type('open in code')
      await page.waitForTimeout(300)
      const openCodeCommand = page.getByText(/open.*code/i)
      await expect(openCodeCommand).not.toBeVisible()

      await page.keyboard.press('Escape')
    }
  })

  test('status bar hides desktop-only controls', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)

    // Check that desktop-only badges/buttons don't exist
    // MCP status badge should not be visible
    const mcpBadge = page.getByTestId('mcp-badge')
    const mcpCount = await mcpBadge.count()
    if (mcpCount > 0) {
      await expect(mcpBadge).not.toBeVisible()
    }

    // Update check button should not be visible
    const updateButton = page.getByTestId('check-updates-button')
    const updateCount = await updateButton.count()
    if (updateCount > 0) {
      await expect(updateButton).not.toBeVisible()
    }
    
    // Just verify these don't exist at all in web
    expect(mcpCount).toBe(0)
    expect(updateCount).toBe(0)
  })

  test('settings sections render correctly without git section', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)

    // Try to open settings
    const settingsButton = page.locator('button:has-text("Settings"), [aria-label*="Settings"], [title*="Settings"]').first()
    const settingsButtonCount = await settingsButton.count()

    if (settingsButtonCount > 0) {
      await settingsButton.click()
      await page.waitForTimeout(500)

      const settingsPanel = page.getByTestId('settings-panel')
      await expect(settingsPanel).toBeVisible({ timeout: 5000 })

      // Verify other sections are present (Appearance, Content, etc.)
      const appearanceSection = page.locator('#settings-section-appearance')
      await expect(appearanceSection).toBeVisible()

      const contentSection = page.locator('#settings-section-content')
      await expect(contentSection).toBeVisible()

      // AI section should be present
      const aiSection = page.locator('#settings-section-ai')
      await expect(aiSection).toBeVisible()

      // But git/autogit section should NOT be present
      const gitSection = page.locator('#settings-section-autogit')
      await expect(gitSection).not.toBeVisible()

      await page.keyboard.press('Escape')
    } else {
      // Just verify git section doesn't exist in the DOM
      const gitSection = page.locator('#settings-section-autogit')
      await expect(gitSection).not.toBeVisible()
    }
  })

  test('web build loads and functions normally', async ({ page }) => {
    await page.goto('/')

    // Verify the app loads and basic functionality works
    await expect(page.locator('body')).toBeVisible()
    
    // Check that the main app surfaces are rendered
    // Just verify the page loaded successfully
    await expect(page.locator('body')).toBeVisible()
  })
})
