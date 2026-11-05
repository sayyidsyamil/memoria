#!/usr/bin/env node
/* global console, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulatorWindowTargetPoint } from '../src/qa/nativeSimulatorWindowGeometry.ts'

function printHelp() {
  console.log(`Click a React Native testID in the visible iOS Simulator window.

Usage:
  node apps/mobile/scripts/click-ios-simulator-element.mjs --test-id <id> [options]

Options:
  --device <udid>  Simulator UDID. Defaults to MOBILE_QA_SIMULATOR_UDID, then the booted iPad.
  --test-id <id>   Exact React Native testID/accessibility identifier to click.
  --wait <ms>      Delay after the click. Defaults to 600.
  --help           Show this help.
`)
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status === 0) return result.stdout
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
  throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

function bootedDevices() {
  const parsed = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']))
  return Object.values(parsed.devices ?? {}).flat()
}

function selectDevice(requestedDevice) {
  if (requestedDevice) return requestedDevice
  const devices = bootedDevices()
  const selected = devices.find((device) => device.name?.toLowerCase().includes('ipad')) ?? devices[0]
  if (!selected?.udid) throw new Error('No booted iOS Simulator found.')
  return selected.udid
}

function deviceName(device) {
  const selected = bootedDevices().find((candidate) => candidate.udid === device)
  if (!selected?.name) throw new Error(`Unable to find booted Simulator device ${device}`)
  return selected.name
}

function axePath() {
  const configured = process.env.MOBILE_QA_AXE_PATH ?? process.env.XCODEBUILDMCP_AXE_PATH
  if (configured) return configured

  const direct = commandPath('axe')
  if (direct) return direct

  const cacheRoot = run('npm', ['config', 'get', 'cache']).trim()
  const npxRoot = join(cacheRoot, '_npx')
  if (!existsSync(npxRoot)) throw new Error('AXe is unavailable. Install xcodebuildmcp or set MOBILE_QA_AXE_PATH.')
  const candidates = readdirSync(npxRoot)
    .map((entry) => join(npxRoot, entry, 'node_modules', 'xcodebuildmcp', 'bundled', 'axe'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  if (!candidates[0]) throw new Error('AXe is unavailable. Install xcodebuildmcp or set MOBILE_QA_AXE_PATH.')
  return candidates[0]
}

function commandPath(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function describeSimulatorUi(device) {
  return JSON.parse(run(axePath(), ['describe-ui', '--udid', device]))
}

function findTarget(nodes, testId) {
  const matches = []
  visitNodes(nodes, (node) => {
    if (node.AXUniqueId === testId && node.frame) matches.push(node)
  })
  if (matches.length !== 1) throw new Error(`Expected one enabled ${testId} target, found ${matches.length}`)
  if (matches[0].enabled === false) throw new Error(`${testId} is disabled`)
  return matches[0]
}

function visitNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    if (Array.isArray(node.children)) visitNodes(node.children, visit)
  }
}

function logicalScreen(nodes) {
  const application = nodes.find((node) => node.role_description === 'application' && node.frame)
  if (!application) throw new Error('Unable to resolve the logical Simulator screen.')
  return application.frame
}

function simulatorSurface(name) {
  const escapedName = escapeAppleScript(name)
  const output = run('osascript', ['-e', `
    tell application "Simulator" to activate
    tell application "System Events"
      tell process "Simulator"
        set frontmost to true
        repeat with candidateWindow in windows
          if ((name of candidateWindow) as text) starts with "${escapedName}" then
            perform action "AXRaise" of candidateWindow
            repeat with candidateElement in UI elements of candidateWindow
              if role of candidateElement is "AXGroup" then
                set surfacePosition to position of candidateElement
                set surfaceSize to size of candidateElement
                return ((item 1 of surfacePosition) as text) & "," & ((item 2 of surfacePosition) as text) & "," & ((item 1 of surfaceSize) as text) & "," & ((item 2 of surfaceSize) as text)
              end if
            end repeat
          end if
        end repeat
        error "No Simulator display surface found for ${escapedName}"
      end tell
    end tell
  `])
  const [x, y, width, height] = output.trim().split(',').map(Number)
  return { height, width, x, y }
}

function escapeAppleScript(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function clickPoint(point) {
  run(coreGraphicsClickerPath(), [String(point.x), String(point.y)])
}

function coreGraphicsClickerPath() {
  const directory = join(tmpdir(), 'memoria-mobile-qa')
  const sourcePath = join(directory, 'click-simulator.swift')
  const binaryPath = join(directory, 'click-simulator')
  if (existsSync(binaryPath)) return binaryPath

  mkdirSync(directory, { recursive: true })
  writeFileSync(sourcePath, coreGraphicsClickSource())
  run('swiftc', [sourcePath, '-o', binaryPath])
  return binaryPath
}

function coreGraphicsClickSource() {
  return `
    import CoreGraphics
    import Darwin

    guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
      exit(2)
    }

    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(50_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(50_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  `
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    printHelp()
    return
  }

  const testId = readOption(args, '--test-id', undefined)
  if (!testId) throw new Error('--test-id is required')
  const device = selectDevice(readOption(args, '--device', process.env.MOBILE_QA_SIMULATOR_UDID))
  const waitMs = Number(readOption(args, '--wait', '600'))
  const ui = describeSimulatorUi(device)
  const target = findTarget(ui, testId)
  const point = simulatorWindowTargetPoint({
    logicalScreen: logicalScreen(ui),
    simulatorSurface: simulatorSurface(deviceName(device)),
    target: target.frame,
  })

  clickPoint(point)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs))
  console.log(JSON.stringify({ device, point, testId }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
