#!/usr/bin/env node
/* global console, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { waitForNativeProof } from './native-ios-proof-logs.mjs'
import { assertNativeQaOpenUrl } from '../src/qa/nativeQaUrls.ts'
import { captureNativeMetroLog } from '../src/qa/nativeMetroProofLog.ts'
import {
  assertNativeWorkspacePersistenceProofs,
  formatNativeWorkspacePersistenceFailures,
  nativeWorkspacePersistenceLogPrefix,
  parseNativeWorkspacePersistenceProofs,
} from '../src/qa/nativeWorkspacePersistenceProbe.ts'

const defaultExpoGoBundleId = 'host.exp.Exponent'
const defaultLogWindow = '90s'
const proofPollTimeoutMs = 12000

function printHelp() {
  console.log(`Assert native iOS Simulator workspace persistence.

Usage:
  node apps/mobile/scripts/assert-ios-workspace-persistence.mjs [options]

Options:
  --device <udid>   Simulator UDID. Defaults to MOBILE_QA_SIMULATOR_UDID, then the booted iPad.
  --last <duration> log show window when no URL is opened. Defaults to ${defaultLogWindow}.
  --open-url <url>  Open an Expo native URL before collecting logs.
  --metro-log <path> Read only newly appended Metro output instead of iOS system logs.
  --phone           Prefer a booted iPhone simulator when --device is not provided.
  --wait <ms>       Delay after opening a URL before collecting logs. Defaults to 6500.
  --help            Show this help.
`)
}

function readConfig(args) {
  return {
    device: readOption(args, '--device', process.env.MOBILE_QA_SIMULATOR_UDID),
    help: args.includes('--help'),
    last: readOption(args, '--last', defaultLogWindow),
    metroLog: readOption(args, '--metro-log', undefined),
    openUrl: readOption(args, '--open-url', undefined),
    phone: args.includes('--phone'),
    waitMs: Number(readOption(args, '--wait', '6500')),
  }
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback

  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)

  return value
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
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

async function openProbeUrl(device, openUrl, waitMs) {
  assertNativeQaOpenUrl(openUrl, 'Native iOS workspace persistence')
  terminateExpoGo(device)
  await sleep(500)
  run('xcrun', ['simctl', 'openurl', device, workspacePersistenceProbeUrl(openUrl)])
  await sleep(Math.max(waitMs, 9000))
}

function workspacePersistenceProbeUrl(openUrl) {
  return appendQueryParam(appendQueryParam(openUrl, 'workspacePersistenceProbe', '1'), 'qaRun', Date.now().toString())
}

function terminateExpoGo(device) {
  const bundleId = process.env.MOBILE_QA_EXPO_GO_BUNDLE_ID ?? defaultExpoGoBundleId
  tryRun('xcrun', ['simctl', 'terminate', device, bundleId])
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
    `eventMessage CONTAINS "${nativeWorkspacePersistenceLogPrefix}"`,
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
  if (config.help) {
    printHelp()
    return
  }

  const device = selectDevice(config.device, config.phone)
  const readMetroLog = captureNativeMetroLog(config.metroLog)
  const logStart = config.openUrl ? simulatorLogTimestamp(new Date(Date.now() - 1000)) : undefined
  if (config.openUrl) await openProbeUrl(device, config.openUrl, config.waitMs)

  const { failures } = await waitForNativeProof({
    assertProofs: assertNativeWorkspacePersistenceProofs,
    collectLogs: () => config.metroLog ? readMetroLog() : collectSimulatorLogs(device, {
      last: config.last,
      start: logStart,
    }),
    parseProofs: parseNativeWorkspacePersistenceProofs,
    timeoutMs: config.openUrl ? proofPollTimeoutMs : 0,
  })
  if (failures.length > 0) {
    throw new Error(`Native workspace persistence proof failed:\n${formatNativeWorkspacePersistenceFailures(failures)}`)
  }

  console.log('Native iOS workspace persistence proof passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
