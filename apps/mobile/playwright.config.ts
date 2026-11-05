import { defineConfig } from '@playwright/test'

const baseURL = process.env.MOBILE_QA_BASE_URL ?? 'http://127.0.0.1:42131'
const port = new URL(baseURL).port || '42131'
const exportDir = process.env.MOBILE_QA_EXPORT_DIR ?? '/tmp/memoria-mobile-ui-web'

export default defineConfig({
  testDir: './tests',
  timeout: 20_000,
  retries: 0,
  workers: 1,
  outputDir: '../../test-results/mobile-ui',
  use: {
    baseURL,
    headless: true,
    trace: 'off',
  },
  projects: [
    {
      name: 'tablet-landscape',
      use: {
        browserName: 'chromium',
        viewport: { width: 1366, height: 1024 },
      },
    },
    {
      name: 'tablet-portrait',
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 1366 },
      },
    },
    {
      name: 'phone-portrait',
      use: {
        browserName: 'chromium',
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `node scripts/serve-export.mjs ${port} ${exportDir}`,
    reuseExistingServer: false,
    timeout: 10_000,
    url: baseURL,
  },
})
