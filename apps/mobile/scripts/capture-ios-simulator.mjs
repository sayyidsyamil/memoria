#!/usr/bin/env node
/* global console, process, setTimeout, URL */

import { mkdir } from 'node:fs/promises'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertNativeQaOpenUrl } from '../src/qa/nativeQaUrls.ts'

const defaultOutputDir = '/tmp/memoria-mobile-ui-simulator'
const defaultExpoGoBundleId = 'host.exp.Exponent'

function printHelp() {
  console.log(`Capture the current iOS Simulator screen for mobile UI QA.

Usage:
  node apps/mobile/scripts/capture-ios-simulator.mjs [options]

Options:
  --device <udid>       Simulator UDID. Defaults to MOBILE_QA_SIMULATOR_UDID, then the booted iPad.
  --dir <path>          Output directory. Defaults to MOBILE_QA_SIMULATOR_SCREENSHOT_DIR or ${defaultOutputDir}.
  --out <path>          Output PNG path. Defaults to <dir>/ipad-landscape.png.
  --landscape           Set the Simulator device orientation to Landscape Right before capture.
  --orientation <value> Set orientation: portrait, landscape-left, or landscape-right.
  --window              Capture the visible Simulator window instead of the selected device framebuffer.
  --framebuffer         Capture the selected device framebuffer. This is the default.
  --no-normalize        Do not rotate framebuffer screenshots to match the requested orientation.
  --open-url <url>      Open a simulator URL before capture. Use exp:// URLs for Expo Go native QA.
                       http(s) URLs are rejected because they open Mobile Safari, not the native app.
  --wait <ms>           Delay after opening a URL and before capture. Defaults to 3000.
  --help                Show this help.
`)
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) {
    return fallback
  }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout
}

function tryRun(command, args) {
  spawnSync(command, args, { encoding: 'utf8' })
}

function hasFlag(args, name) {
  return args.includes(name)
}

function listBootedDevices() {
  const json = run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'])
  const parsed = JSON.parse(json)
  return Object.values(parsed.devices ?? {}).flat()
}

function selectDevice(requestedDevice) {
  if (requestedDevice) {
    return requestedDevice
  }

  const bootedDevices = listBootedDevices()
  const iPad = bootedDevices.find((device) => device.name?.toLowerCase().includes('ipad'))
  const selected = iPad ?? bootedDevices[0]
  if (!selected?.udid) {
    throw new Error('No booted iOS Simulator found. Start one with `pnpm mobile:ios` first.')
  }
  return selected.udid
}

function orientationMenuItem(value) {
  if (value === 'portrait') return 'Portrait'
  if (value === 'landscape-left') return 'Landscape Left'
  if (value === 'landscape-right') return 'Landscape Right'
  throw new Error(`Unsupported orientation: ${value}`)
}

function setSimulatorOrientation(value) {
  const menuItem = orientationMenuItem(value)
  run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events" to tell process "Simulator" to click menu item "${menuItem}" of menu 1 of menu item "Orientation" of menu "Device" of menu bar 1`,
  ])
}

function simulatorWindowRect(deviceName) {
  const escapedDeviceName = escapeAppleScriptText(deviceName)
  const output = run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events"
      tell process "Simulator"
        repeat with candidateWindow in windows
          if ((name of candidateWindow) as text) starts with "${escapedDeviceName}" then
            set windowPosition to position of candidateWindow
            set windowSize to size of candidateWindow
            return ((item 1 of windowPosition) as text) & "," & ((item 2 of windowPosition) as text) & "," & ((item 1 of windowSize) as text) & "," & ((item 2 of windowSize) as text)
          end if
        end repeat
        error "No Simulator window found for ${escapedDeviceName}"
      end tell
    end tell`,
  ])
  const values = output.trim().split(',').map((value) => Number(value))
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Unable to read Simulator window bounds: ${output.trim()}`)
  }
  return values.join(',')
}

function selectedDeviceName(device) {
  const devices = listBootedDevices()
  const selected = devices.find((candidate) => candidate.udid === device)
  if (!selected?.name) {
    throw new Error(`Unable to find booted Simulator device for UDID ${device}`)
  }
  return selected.name
}

function escapeAppleScriptText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function raiseSimulatorWindow(deviceName) {
  const escapedDeviceName = escapeAppleScriptText(deviceName)
  run('osascript', [
    '-e',
    'tell application "Simulator" to activate',
    '-e',
    `tell application "System Events"
      tell process "Simulator"
        repeat with candidateWindow in windows
          if ((name of candidateWindow) as text) starts with "${escapedDeviceName}" then
            perform action "AXRaise" of candidateWindow
            return
          end if
        end repeat
      end tell
      error "No Simulator window found for ${escapedDeviceName}"
    end tell`,
  ])
}

function captureSimulatorWindow(deviceName, outputPath) {
  raiseSimulatorWindow(deviceName)
  run('screencapture', ['-x', `-R${simulatorWindowRect(deviceName)}`, outputPath])
}

function captureSimulatorFramebuffer(device, outputPath) {
  const staging = mkdtempSync(join(tmpdir(), 'memoria-simulator-capture-'))
  try {
    const image = join(staging, 'screen.png')
    run('xcrun', ['simctl', 'io', device, 'screenshot', image])
    copyFileSync(image, outputPath)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function normalizeFramebufferOrientation(outputPath, orientation) {
  if (!orientation?.startsWith('landscape')) {
    return
  }

  const { width, height } = imageSize(outputPath)
  if (width > height) {
    return
  }

  const rotation = orientation === 'landscape-left' ? '-90' : '90'
  run('sips', ['-r', rotation, outputPath])
}

function imageSize(path) {
  const output = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path])
  const widthMatch = output.match(/pixelWidth:\s*(\d+)/u)
  const heightMatch = output.match(/pixelHeight:\s*(\d+)/u)
  const width = Number(widthMatch?.[1])
  const height = Number(heightMatch?.[1])
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Unable to read image size for ${path}`)
  }
  return { width, height }
}

function readCaptureOptions(args) {
  if (args.includes('--help')) {
    printHelp()
    return undefined
  }

  const device = selectDevice(readOption(args, '--device', process.env.MOBILE_QA_SIMULATOR_UDID))
  const outputDir = resolve(
    readOption(args, '--dir', process.env.MOBILE_QA_SIMULATOR_SCREENSHOT_DIR ?? defaultOutputDir),
  )
  const outputPath = resolve(readOption(args, '--out', join(outputDir, 'ipad-landscape.png')))
  const waitMs = Number(readOption(args, '--wait', '3000'))
  const url = readOption(args, '--open-url', undefined)
  const requestedOrientation = readOption(args, '--orientation', hasFlag(args, '--landscape') ? 'landscape-right' : undefined)
  const useWindowCapture = hasFlag(args, '--window')
  const useFramebufferCapture = hasFlag(args, '--framebuffer') || !useWindowCapture
  const normalizeFramebuffer = !hasFlag(args, '--no-normalize')

  if (hasFlag(args, '--window') && hasFlag(args, '--framebuffer')) {
    throw new Error('Use either --window or --framebuffer, not both.')
  }

  return {
    device,
    normalizeFramebuffer,
    outputPath,
    requestedOrientation,
    url,
    useFramebufferCapture,
    waitMs,
  }
}

async function orientSimulator(deviceName, requestedOrientation) {
  if (!requestedOrientation) {
    return
  }

  raiseSimulatorWindow(deviceName)
  setSimulatorOrientation(requestedOrientation)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
}

async function openSimulatorUrl(device, url, waitMs) {
  if (!url) {
    return
  }

  assertNativeQaOpenUrl(url, 'Native iOS simulator capture')
  if (isExpoGoUrl(url)) {
    terminateExpoGo(device)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    const runId = Date.now().toString()
    run('xcrun', ['simctl', 'openurl', device, appendQueryParam(url, 'qaRun', runId)])
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(waitMs, 9000)))
    return
  }

  const runId = Date.now().toString()
  run('xcrun', ['simctl', 'openurl', device, appendQueryParam(url, 'qaRun', `${runId}-reset`)])
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(waitMs, 750)))
  run('xcrun', ['simctl', 'openurl', device, appendQueryParam(url, 'qaRun', runId)])
  await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs))
}

function isExpoGoUrl(url) {
  const protocol = new URL(url).protocol.toLowerCase()
  return protocol === 'exp:' || protocol === 'exps:'
}

function terminateExpoGo(device) {
  const bundleId = process.env.MOBILE_QA_EXPO_GO_BUNDLE_ID ?? defaultExpoGoBundleId
  tryRun('xcrun', ['simctl', 'terminate', device, bundleId])
}

function appendQueryParam(url, key, value) {
  const parsed = new URL(url)
  parsed.searchParams.set(key, value)
  return parsed.toString()
}

function captureSelectedDevice(options, deviceName) {
  if (options.useFramebufferCapture) {
    captureSimulatorFramebuffer(options.device, options.outputPath)
    if (options.normalizeFramebuffer) {
      normalizeFramebufferOrientation(options.outputPath, options.requestedOrientation)
    }
    return
  }

  captureSimulatorWindow(deviceName, options.outputPath)
}

async function main() {
  const options = readCaptureOptions(process.argv.slice(2))
  if (!options) {
    return
  }

  await mkdir(dirname(options.outputPath), { recursive: true })

  const deviceName = selectedDeviceName(options.device)
  await orientSimulator(deviceName, options.requestedOrientation)
  await openSimulatorUrl(options.device, options.url, options.waitMs)
  captureSelectedDevice(options, deviceName)

  console.log(`Captured iOS Simulator screenshot: ${options.outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
