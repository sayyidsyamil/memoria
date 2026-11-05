#!/usr/bin/env node
/* global console, process, setTimeout, URL */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { waitForNativeProof } from './native-ios-proof-logs.mjs'
import { assertNativeQaOpenUrl } from '../src/qa/nativeQaUrls.ts'
import {
  mobileLaunchSearchArgumentName,
  mobileLaunchSearchEnvironmentName,
} from '../src/native/mobileNativeKeyCommandsContract.ts'
import {
  assertNativeMobileKeyboardShortcutProofs,
  formatNativeMobileKeyboardShortcutFailures,
  nativeMobileKeyboardShortcutLogPrefix,
  parseNativeMobileKeyboardShortcutProofs,
} from '../src/qa/nativeMobileKeyboardShortcutProofContract.ts'

const defaultExpoGoBundleId = 'host.exp.Exponent'
const defaultLogWindow = '90s'
const defaultKeyDelivery = 'auto'
const nativeKeyboardShortcutProbeEnvironmentName = 'MEMORIA_MOBILE_KEYBOARD_SHORTCUT_PROBE'
const proofPollTimeoutMs = 18000
const shortcutProofs = [
  { id: 'command-palette', keyCodes: [227, 14], sendAppleScript: () => pressCommandKey('k') },
  { id: 'find-in-note', keyCodes: [227, 9], sendAppleScript: () => pressCommandKey('f') },
  { id: 'search-o', keyCodes: [227, 18], sendAppleScript: () => pressCommandKey('o') },
  { id: 'search-p', keyCodes: [227, 19], sendAppleScript: () => pressCommandKey('p') },
  { id: 'raw-editor', keyCodes: [227, 49], sendAppleScript: () => pressCommandKeyCode(42) },
  { id: 'create-note', keyCodes: [227, 17], sendAppleScript: () => pressCommandKey('n') },
  { id: 'next-note', keyCodes: [81], sendAppleScript: () => pressKeyCode(125) },
  { id: 'previous-note', keyCodes: [82], sendAppleScript: () => pressKeyCode(126) },
]

function printHelp() {
  console.log(`Assert native iOS Simulator keyboard shortcuts.

Usage:
  node apps/mobile/scripts/assert-ios-keyboard-shortcuts.mjs [options]

Options:
  --device <udid>   Simulator UDID. Defaults to MOBILE_QA_SIMULATOR_UDID, then the booted iPad.
  --bundle-id <id>  Launch this native app bundle with QA launch args instead of opening an Expo URL.
  --key-delivery <auto|hid|applescript>
                    Keyboard event backend. Defaults to ${defaultKeyDelivery}; HID uses xcodebuildmcp/AXe.
  --last <duration> log show window when no URL is opened. Defaults to ${defaultLogWindow}.
  --open-url <url>  Open an Expo native URL before collecting logs.
  --phone           Prefer a booted iPhone simulator when --device is not provided.
  --wait <ms>       Delay after opening a URL before pressing keys. Defaults to 4500.
  --help            Show this help.
`)
}

function readConfig(args) {
  return {
    device: readOption(args, '--device', process.env.MOBILE_QA_SIMULATOR_UDID),
    bundleId: readOption(args, '--bundle-id', process.env.MOBILE_QA_NATIVE_BUNDLE_ID),
    help: args.includes('--help'),
    keyDelivery: readOption(args, '--key-delivery', process.env.MOBILE_QA_KEY_DELIVERY ?? defaultKeyDelivery),
    last: readOption(args, '--last', defaultLogWindow),
    openUrl: readOption(args, '--open-url', undefined),
    phone: args.includes('--phone'),
    waitMs: Number(readOption(args, '--wait', '4500')),
  }
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback

  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)

  return value
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status === 0) return [result.stdout, result.stderr].filter(Boolean).join('\n')

  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
  throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

function tryRun(command, args) {
  spawnSync(command, args, { encoding: 'utf8' })
}

function selectDevice(requestedDevice, preferPhone) {
  if (requestedDevice) return requestedDevice

  const json = run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'])
  const devices = Object.values(JSON.parse(json).devices ?? {}).flat()
  const preferredName = preferPhone ? 'iphone' : 'ipad'
  const selected = devices.find((device) => device.name?.toLowerCase().includes(preferredName)) ?? devices[0]
  if (!selected?.udid) throw new Error('No booted iOS Simulator found.')

  return selected.udid
}

function assertKnownKeyDelivery(value) {
  if (value === 'auto' || value === 'hid' || value === 'applescript') return value
  throw new Error(`Unsupported --key-delivery value: ${value}`)
}

async function openProbeUrl(device, config) {
  const { bundleId, keyDelivery, openUrl } = config
  assertNativeQaOpenUrl(openUrl, 'Native iOS keyboard shortcut proof')

  const delivery = assertKnownKeyDelivery(keyDelivery)
  if (delivery !== 'applescript' && bundleId) {
    try {
      await sendKeyboardShortcutProofsWithHid(device, config)
      return
    } catch (error) {
      if (delivery === 'hid') throw error
      console.warn(`Falling back to AppleScript keyboard delivery after HID failure: ${error.message}`)
    }
  }

  const probeUrl = keyboardShortcutProbeUrl(openUrl, 'applescript')
  if (bundleId) {
    launchNativeProbe(device, bundleId, probeUrl)
  } else {
    terminateExpoGo(device)
    await sleep(500)
    openSimulatorUrl(device, probeUrl)
  }

  await sleep(Math.max(config.waitMs, 9000))
  await sendKeyboardShortcutSequenceWithAppleScript()
}

async function sendKeyboardShortcutProofsWithHid(device, { bundleId, openUrl, waitMs }) {
  for (const shortcut of shortcutProofs) {
    const probeUrl = keyboardShortcutProbeUrl(openUrl, shortcut.id)
    launchNativeProbe(device, bundleId, probeUrl)
    await waitForNativeShortcutBridge(device, qaRunFromProbeUrl(probeUrl), waitMs)
    sendHidKeySequence(device, shortcut.keyCodes)
    await sleep(650)
  }
}

async function waitForNativeShortcutBridge(device, qaRun, waitMs) {
  const deadline = Date.now() + Math.max(waitMs, 9000)
  while (Date.now() < deadline) {
    const logs = collectSimulatorLogs(device, { last: defaultLogWindow })
    if (logs.includes(`"qaRun":"${qaRun}"`)) return
    await sleep(250)
  }
  throw new Error('Native keyboard shortcut bridge did not become ready before HID delivery')
}

function qaRunFromProbeUrl(probeUrl) {
  const value = new URL(probeUrl).searchParams.get('qaRun')
  if (!value) throw new Error('Native keyboard shortcut probe URL is missing qaRun')
  return value
}

function launchNativeProbe(device, bundleId, probeUrl) {
  const launchSearch = launchSearchFromUrl(probeUrl)
  run('xcrun', [
    'simctl',
    'launch',
    '--terminate-running-process',
    device,
    bundleId,
    mobileLaunchSearchArgumentName,
    launchSearch,
  ], {
    env: {
      ...process.env,
      [`SIMCTL_CHILD_${nativeKeyboardShortcutProbeEnvironmentName}`]: '1',
      [`SIMCTL_CHILD_${mobileLaunchSearchEnvironmentName}`]: launchSearch,
    },
  })
}

function openSimulatorUrl(device, url) {
  try {
    run('xcrun', ['simctl', 'openurl', device, url])
  } catch (error) {
    if (!isSimulatorOpenUrlTimeout(error)) throw error
    console.warn(`Continuing after simulator URL timeout; proof logs will verify launch: ${error.message}`)
  }
}

function isSimulatorOpenUrlTimeout(error) {
  return error instanceof Error
    && error.message.includes('simctl openurl')
    && error.message.includes('Operation timed out')
}

function keyboardShortcutProbeUrl(openUrl, id) {
  const qaRun = `${Date.now().toString()}-${id}`
  return appendQueryParam(appendQueryParam(openUrl, 'mobileKeyboardShortcutProbe', '1'), 'qaRun', qaRun)
}

function launchSearchFromUrl(url) {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return ''

  return url.slice(queryStart + 1)
}

function terminateExpoGo(device) {
  const bundleId = process.env.MOBILE_QA_EXPO_GO_BUNDLE_ID ?? defaultExpoGoBundleId
  tryRun('xcrun', ['simctl', 'terminate', device, bundleId])
}

async function sendKeyboardShortcutSequenceWithAppleScript() {
  for (const shortcut of shortcutProofs) {
    shortcut.sendAppleScript()
    await sleep(350)
  }
}

function sendHidKeySequence(device, keyCodes) {
  const axe = axeBinary()
  const key = keyCodes.at(-1)
  const modifiers = keyCodes.slice(0, -1)
  if (key === undefined) throw new Error('HID shortcut requires at least one key code')

  if (modifiers.length > 0) {
    run(axe, ['key-combo', '--modifiers', modifiers.join(','), '--key', String(key), '--udid', device])
    return
  }

  run(axe, ['key', String(key), '--udid', device])
}

function axeBinary() {
  if (process.env.MOBILE_QA_AXE_PATH) return process.env.MOBILE_QA_AXE_PATH

  const command = commandPath('axe')
  if (command) return command

  const cachedBinary = cachedAxeBinary()
  if (cachedBinary) return cachedBinary

  throw new Error('AXe is required for native HID shortcut QA. Set MOBILE_QA_AXE_PATH.')
}

function commandPath(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function cachedAxeBinary() {
  const cacheRoot = npmCachePath()
  if (!cacheRoot) return ''

  const candidates = axeSearchRoots(cacheRoot)
    .flatMap((root) => axeCandidates(root))
    .filter(existsSync)
    .sort((left, right) => mtimeMs(right) - mtimeMs(left))

  return candidates[0] ?? ''
}

function axeSearchRoots(cacheRoot) {
  return [join(cacheRoot, '_npx'), join(cacheRoot, 'dlx')].filter(existsSync)
}

function axeCandidates(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (!entry.isDirectory()) return []
    const direct = join(path, 'node_modules', 'xcodebuildmcp', 'bundled', 'axe')
    const nested = readdirSync(path, { withFileTypes: true })
      .filter((child) => child.isDirectory())
      .map((child) => join(path, child.name, 'node_modules', 'xcodebuildmcp', 'bundled', 'axe'))

    return [direct, ...nested]
  })
}

function npmCachePath() {
  if (process.env.npm_config_cache) return process.env.npm_config_cache

  const result = spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function pressCommandKey(key) {
  run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events" to keystroke ${JSON.stringify(key)} using command down`,
  ])
}

function pressCommandKeyCode(keyCode) {
  run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events" to key code ${keyCode} using command down`,
  ])
}

function pressKeyCode(keyCode) {
  run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events" to key code ${keyCode}`,
  ])
}

function collectSimulatorLogs(device, { last, start }) {
  return run('xcrun', [
    'simctl',
    'spawn',
    device,
    'log',
    'show',
    ...(start ? ['--start', start] : ['--last', last]),
    '--style',
    'compact',
    '--predicate',
    `eventMessage CONTAINS "${nativeMobileKeyboardShortcutLogPrefix}"`,
  ])
}

function appendQueryParam(url, key, value) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function simulatorLogTimestamp(date) {
  const dateParts = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(padTimestampPart)
  const timeParts = [date.getHours(), date.getMinutes(), date.getSeconds()].map(padTimestampPart)
  return `${dateParts.join('-')} ${timeParts.join(':')}`
}

function padTimestampPart(value) {
  return String(value).padStart(2, '0')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const config = readConfig(process.argv.slice(2))
  assertKnownKeyDelivery(config.keyDelivery)
  if (config.help) {
    printHelp()
    return
  }

  const device = selectDevice(config.device, config.phone)
  const logStart = config.openUrl ? simulatorLogTimestamp(new Date(Date.now() - 1000)) : undefined
  if (config.openUrl) await openProbeUrl(device, config)

  const { failures } = await waitForNativeProof({
    assertProofs: assertNativeMobileKeyboardShortcutProofs,
    collectLogs: () => collectSimulatorLogs(device, {
      last: config.last,
      start: logStart,
    }),
    parseProofs: parseNativeMobileKeyboardShortcutProofs,
    timeoutMs: config.openUrl ? proofPollTimeoutMs : 0,
  })
  if (failures.length > 0) {
    throw new Error(`Native keyboard shortcut proof failed:\n${formatNativeMobileKeyboardShortcutFailures(failures)}`)
  }

  console.log('Native iOS keyboard shortcut proof passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
