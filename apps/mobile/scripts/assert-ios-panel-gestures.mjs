#!/usr/bin/env node
/* global console, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulatorWindowTargetPoint } from '../src/qa/nativeSimulatorWindowGeometry.ts'

const defaultBundleId = 'com.memoria.mobile.dev'
const editorPanel = 'editor-panel'
const noteListPanel = 'note-list-panel'
const propertiesAction = 'editor-properties-action'
const propertiesPanel = 'properties-panel'
const sidebarPanel = 'workspace-sidebar-panel'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  if (result.status === 0) return result.stdout
  const detail = result.stderr?.trim()
    || result.stdout?.trim()
    || result.error?.message
    || `exit ${result.status}`
  throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
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

  const cacheRoot = run('npm', ['config', 'get', 'cache']).trim()
  const npxRoot = join(cacheRoot, '_npx')
  if (!existsSync(npxRoot)) throw new Error('AXe is unavailable. Set MOBILE_QA_AXE_PATH.')
  const candidates = readdirSync(npxRoot)
    .map((entry) => join(npxRoot, entry, 'node_modules', 'xcodebuildmcp', 'bundled', 'axe'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  if (!candidates[0]) throw new Error('AXe is unavailable. Set MOBILE_QA_AXE_PATH.')
  return candidates[0]
}

function describeUi(device) {
  return JSON.parse(run(axePath(), ['describe-ui', '--udid', device]))
}

function visitNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    if (Array.isArray(node.children)) visitNodes(node.children, visit)
  }
}

function findElement(nodes, testId) {
  const matches = []
  visitNodes(nodes, (node) => {
    if (node.AXUniqueId === testId && node.frame) matches.push(node)
  })
  if (matches.length !== 1) throw new Error(`Expected one ${testId} target, found ${matches.length}`)
  return matches[0]
}

function assertElementAbsent(nodes, testId) {
  const count = elementCount(nodes, testId)
  if (count !== 0) throw new Error(`Expected ${testId} to be absent, found ${count}`)
}

function elementCount(nodes, testId) {
  let count = 0
  visitNodes(nodes, (node) => {
    if (node.AXUniqueId === testId) count += 1
  })
  return count
}

function logicalScreen(nodes) {
  const application = nodes.find((node) => node.role_description === 'application' && node.frame)
  if (!application) throw new Error('Unable to resolve the logical Simulator screen.')
  if (application.frame.width <= application.frame.height) {
    throw new Error('Panel gesture QA requires the iPad Simulator in landscape orientation.')
  }
  return application.frame
}

function simulatorSurface(name) {
  const escapedName = name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
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

function dragBinaryPath() {
  const directory = join(tmpdir(), 'memoria-mobile-qa')
  const sourcePath = join(directory, 'drag-simulator.swift')
  const binaryPath = join(directory, 'drag-simulator')
  if (existsSync(binaryPath)) return binaryPath

  mkdirSync(directory, { recursive: true })
  writeFileSync(sourcePath, dragSource())
  run('swiftc', [sourcePath, '-o', binaryPath])
  return binaryPath
}

function dragSource() {
  return `
    import CoreGraphics
    import Darwin

    guard CommandLine.arguments.count == 5,
      let startX = Double(CommandLine.arguments[1]),
      let startY = Double(CommandLine.arguments[2]),
      let endX = Double(CommandLine.arguments[3]),
      let endY = Double(CommandLine.arguments[4]) else {
      exit(2)
    }

    let steps = 100
    func post(_ type: CGEventType, _ x: Double, _ y: Double) {
      CGEvent(
        mouseEventSource: nil,
        mouseType: type,
        mouseCursorPosition: CGPoint(x: x, y: y),
        mouseButton: .left
      )?.post(tap: .cghidEventTap)
    }

    post(.mouseMoved, startX, startY)
    usleep(150_000)
    post(.leftMouseDown, startX, startY)
    for index in 1...steps {
      let progress = Double(index) / Double(steps)
      post(
        .leftMouseDragged,
        startX + (endX - startX) * progress,
        startY + (endY - startY) * progress
      )
      usleep(10_000)
    }
    post(.leftMouseUp, endX, endY)
  `
}

function dragElement({ anchorX = 0.5, deltaX, device, name, testId }) {
  const ui = describeUi(device)
  const screen = logicalScreen(ui)
  const surface = simulatorSurface(name)
  const target = findElement(ui, testId).frame
  const startTarget = pointTarget({
    screen,
    x: target.x + target.width * anchorX,
    y: target.y + target.height / 2,
  })
  const endTarget = pointTarget({ screen, x: startTarget.x + deltaX, y: startTarget.y })
  const start = simulatorWindowTargetPoint({ logicalScreen: screen, simulatorSurface: surface, target: startTarget })
  const end = simulatorWindowTargetPoint({ logicalScreen: screen, simulatorSurface: surface, target: endTarget })
  run(dragBinaryPath(), [String(start.x), String(start.y), String(end.x), String(end.y)])
}

function dragFromRightEdge({ deltaX, device, name }) {
  const ui = describeUi(device)
  const screen = logicalScreen(ui)
  const surface = simulatorSurface(name)
  const editor = findElement(ui, editorPanel).frame
  const startTarget = pointTarget({
    screen,
    x: screen.x + screen.width - 2,
    y: editor.y + editor.height / 2,
  })
  const endTarget = pointTarget({ screen, x: startTarget.x + deltaX, y: startTarget.y })
  const start = simulatorWindowTargetPoint({ logicalScreen: screen, simulatorSurface: surface, target: startTarget })
  const end = simulatorWindowTargetPoint({ logicalScreen: screen, simulatorSurface: surface, target: endTarget })
  run(dragBinaryPath(), [String(start.x), String(start.y), String(end.x), String(end.y)])
}

function pointTarget({ screen, x, y }) {
  return {
    height: 2,
    width: 2,
    x: Math.max(screen.x, Math.min(screen.x + screen.width - 2, x)),
    y: Math.max(screen.y, Math.min(screen.y + screen.height - 2, y)),
  }
}

function launchFixture(device, bundleId) {
  const search = '?source=fixture&tabletPanels=all&selectedNote=workflow-orchestration&qaRun=panel-gestures'
  spawnSync('xcrun', ['simctl', 'terminate', device, bundleId])
  run('xcrun', ['simctl', 'openurl', device, `exp://127.0.0.1:8081/--/${search}`])
}

async function waitForAnimation() {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 900))
}

function assertPanels(device, { hidden = [], visible = [] }) {
  const ui = describeUi(device)
  visible.forEach((testId) => { findElement(ui, testId) })
  hidden.forEach((testId) => { assertElementAbsent(ui, testId) })
}

async function main() {
  const args = process.argv.slice(2)
  const device = selectDevice(readOption(args, '--device', process.env.MOBILE_QA_SIMULATOR_UDID))
  const bundleId = readOption(args, '--bundle-id', process.env.MOBILE_QA_APP_BUNDLE_ID ?? defaultBundleId)
  const name = deviceName(device)

  launchFixture(device, bundleId)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 6000))
  if (elementCount(describeUi(device), propertiesPanel) === 0) {
    dragElement({ deltaX: 0, device, name, testId: propertiesAction })
    await waitForAnimation()
  }
  assertPanels(device, { visible: [sidebarPanel, noteListPanel, editorPanel, propertiesPanel, propertiesAction] })

  dragElement({ deltaX: 0, device, name, testId: propertiesAction })
  await waitForAnimation()
  assertPanels(device, { hidden: [propertiesPanel], visible: [sidebarPanel, noteListPanel, editorPanel] })
  dragElement({ deltaX: 0, device, name, testId: propertiesAction })
  await waitForAnimation()
  assertPanels(device, { visible: [propertiesPanel] })
  dragElement({ deltaX: 0, device, name, testId: propertiesAction })
  await waitForAnimation()

  dragElement({ anchorX: 0.9, deltaX: -520, device, name, testId: noteListPanel })
  await waitForAnimation()
  assertPanels(device, { hidden: [sidebarPanel, noteListPanel], visible: [editorPanel] })
  dragElement({ anchorX: 0.1, deltaX: 250, device, name, testId: editorPanel })
  await waitForAnimation()
  assertPanels(device, { hidden: [sidebarPanel], visible: [noteListPanel, editorPanel] })
  dragElement({ anchorX: 0.2, deltaX: 220, device, name, testId: noteListPanel })
  await waitForAnimation()
  assertPanels(device, { visible: [sidebarPanel, noteListPanel, editorPanel] })

  dragFromRightEdge({ deltaX: -200, device, name })
  await waitForAnimation()
  assertPanels(device, { visible: [propertiesPanel] })
  dragElement({ anchorX: 0.1, deltaX: 220, device, name, testId: propertiesPanel })
  await waitForAnimation()
  assertPanels(device, { hidden: [propertiesPanel], visible: [editorPanel] })

  console.log(JSON.stringify({ bundleId, device, status: 'passed', transitions: 8 }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
