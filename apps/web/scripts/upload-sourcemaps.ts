import { fileURLToPath } from 'node:url'
import { uploadConfigFromEnv, uploadSourceMaps } from '../sourcemapUpload.ts'

// TOL-232: `pnpm upload:web-sourcemaps`, run by the deploy after `pnpm build:web`.
// Reads SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT and SENTRY_URL (docs/web/telemetry.md).

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const mapsDir = fileURLToPath(new URL('../sourcemaps', import.meta.url))

async function main(): Promise<void> {
  const config = uploadConfigFromEnv(process.env)
  if (!config) {
    console.log('web source maps: SENTRY_AUTH_TOKEN is not set, upload skipped')
    return
  }
  const { release, files } = await uploadSourceMaps({ config, distDir, mapsDir })
  console.log(`web source maps: uploaded ${files} files to Sentry release ${release}`)
}

main().catch((error: unknown) => {
  console.error(`web source maps: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
