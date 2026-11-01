import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const mobileRoot = path.join(repoRoot, 'apps/mobile')
const profiles = {
  alpha: { profile: 'testflight', distribution: 'testflight', release: 'alpha', environment: 'preview' },
  stable: { profile: 'production', distribution: 'store', release: 'stable', environment: 'production' },
  'ota-validation': { profile: 'ota-validation', distribution: 'internal', release: 'alpha', environment: 'preview' },
}

export function publishMobileUpdate(environment, execute = executeCommand) {
  const options = publishingOptions(environment)
  const baseRef = environment.MEMORIA_OTA_BASE_REF
    || execute('git', ['rev-list', '--max-parents=0', 'HEAD'], options).trim()
  const base = execute('git', ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`], options).trim()
  const ancestor = execute('git', ['merge-base', base, 'HEAD'], options).trim()
  assert.equal(ancestor, base, 'OTA change base must be an ancestor of this source commit')
  const files = execute('git', ['diff', '--name-only', '-z', base, 'HEAD', '--'], options).split('\0')
  if (!files.some(mobileRuntimePath)) return { published: false, reason: 'No mobile runtime inputs changed' }
  validateNativeTarget(environment)
  requireCredentials(environment)
  const runtime = JSON.parse(execute('pnpm', ['exec', 'expo-updates', 'runtimeversion:resolve',
    '--platform', 'ios', '--workflow', 'managed'], { ...options, cwd: mobileRoot })).runtimeVersion
  assert.equal(runtime, environment.MEMORIA_OTA_RUNTIME, 'Expected native runtime differs; install and accept a new binary first')
  const sha = execute('git', ['rev-parse', 'HEAD'], options).trim()
  assert.match(sha, /^[a-f0-9]{40}$/, 'Invalid source commit')
  const output = `/tmp/memoria-ota-${sha}`
  execute('pnpm', ['--filter', '@memoria/mobile', 'exec', 'expo', 'export', '--platform', 'ios',
    '--source-maps', '--output-dir', output], options)
  execute('pnpm', ['--filter', '@memoria/mobile', 'exec', 'sentry-cli', 'sourcemaps', 'upload',
    '--org', environment.SENTRY_ORG, '--project', environment.SENTRY_PROJECT,
    '--strict', '--validate', '--wait-for', '120', '--debug-id-reference', '--ext', 'hbc', '--ext', 'map',
    path.join(output, '_expo/static/js/ios')], options)
  const receipt = execute(environment.MEMORIA_EAS_CLI || 'eas', ['update', '--channel', options.channel,
    '--environment', profiles[options.channel].environment, '--platform', 'ios',
    '--input-dir', output, '--skip-bundler', '--message', `Memoria mobile ${sha}`, '--non-interactive', '--json'],
  { ...options, cwd: mobileRoot })
  validatePublication(receipt, { channel: options.channel, runtime, sha })
  return { published: true, channel: options.channel, runtime, sha }
}

function publishingOptions(environment) {
  const channel = releaseChannel(environment)
  return { cwd: repoRoot, channel, env: {
    ...environment, EXPO_NO_DOTENV: '1', MEMORIA_BUILD_PROFILE: profiles[channel].profile, MEMORIA_UPDATE_CHANNEL: channel,
    EXPO_PUBLIC_DISTRIBUTION: profiles[channel].distribution, EXPO_PUBLIC_RELEASE_CHANNEL: profiles[channel].release,
  } }
}

function releaseChannel(environment) {
  const channel = environment.MEMORIA_OTA_CHANNEL
  assert(Object.hasOwn(profiles, channel), 'Unknown mobile OTA channel')
  assert(channel === 'ota-validation' || environment.CIRCLE_BRANCH === 'main', 'Release OTA publishing requires main')
  return channel
}

function validateNativeTarget(environment) {
  assert.match(environment.MEMORIA_OTA_RUNTIME ?? '', /^[a-f0-9]{40,64}$/, 'Accepted native runtime is required')
  assert.match(environment.MEMORIA_IOS_BUILD_NUMBER ?? '', /^[1-9][0-9]{0,3}$/, 'Accepted native build number is required')
}

function mobileRuntimePath(file) {
  if (/^apps\/mobile\/(?:docs|tests|native-ui-tests|scripts)\//.test(file)) return false
  return /^(?:apps\/mobile\/|packages\/|src\/(?:lib|utils|shared)\/|src-tauri\/icons\/)/.test(file)
    || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(file)
}

function requireCredentials(environment) {
  for (const key of ['EXPO_TOKEN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT',
    'EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_POSTHOG_KEY', 'EXPO_PUBLIC_POSTHOG_HOST']) {
    assert(environment[key]?.trim(), `${key} is required for OTA publishing`)
  }
}

function validatePublication(receipt, expected) {
  const updates = JSON.parse(receipt)
  assert(Array.isArray(updates), 'Invalid EAS publishing receipt')
  assert.equal(updates.length, 1, 'Expected exactly one iOS update')
  const update = updates[0]
  assert.equal(update.platform, 'ios', 'Published platform differs from accepted target')
  assert.equal(update.branch, expected.channel, 'Published branch differs from accepted channel')
  assert.equal(update.runtimeVersion, expected.runtime, 'Published runtime differs from accepted native binary')
  assert.equal(update.gitCommitHash, expected.sha, 'Published source commit differs from exported source')
}

function executeCommand(command, args, options) {
  return execFileSync(command, args, { cwd: options.cwd, env: options.env, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024 })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(publishMobileUpdate(process.env)))
}
