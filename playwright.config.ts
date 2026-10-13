import { defineConfig } from '@playwright/test'

const PORT = 5199

// Set MEMORIA_E2E_CHROMIUM to a Chromium binary if the one Playwright expects is not installed.
// Browser mock mode only: the UI runs in plain Chromium against vite, with the mocked Tauri layer.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    headless: true,
    launchOptions: { executablePath: process.env.MEMORIA_E2E_CHROMIUM || undefined },
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
