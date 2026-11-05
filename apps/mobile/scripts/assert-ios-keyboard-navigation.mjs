#!/usr/bin/env node
/* global console, process, setTimeout */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// XCTest on iOS 18.3 drops special keys during character-map normalization.
// Send actual HID events and assert native accessibility state instead.
const device = process.env.MOBILE_QA_SIMULATOR_UDID
const axe = process.env.MOBILE_QA_AXE_PATH
assert(device && axe, 'Set MOBILE_QA_SIMULATOR_UDID and MOBILE_QA_AXE_PATH')

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
}

function interact(...args) {
  run(axe, [...args, '--udid', device])
}

function flatten(elements) {
  return elements.flatMap((element) => [element, ...flatten(element.children ?? [])])
}

function snapshot() {
  return flatten(JSON.parse(run(axe, ['describe-ui', '--udid', device])))
}

function byId(elements, id) {
  return elements.find((element) => element.AXUniqueId === id)
}

async function waitFor(description, predicate) {
  const deadline = Date.now() + 12000
  do {
    const elements = snapshot()
    if (predicate(elements)) return elements
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
  assert.fail(description)
}

function hasTitle(elements, slot, title) {
  // RN can flatten the Text wrapper after an update, losing its testID.
  // Match the visible text in the measured toolbar slot, not the note-list copy.
  return elements.some((element) => element.AXLabel === title
    && Math.abs(element.frame.x - slot.x) < 1
    && Math.abs(element.frame.y - slot.y) < 1)
}

function toolbarTitle(elements, label, actionId) {
  const action = byId(elements, actionId)
  if (!action) return undefined
  return elements.find((element) => element.AXLabel === label && element.type === 'StaticText'
    && Math.abs(element.frame.y + element.frame.height / 2 - action.frame.y - action.frame.height / 2) < 2)
}

function key(code) { interact('key', String(code)) }

async function checkNoteNavigation(initial) {
  const title = toolbarTitle(initial, 'Workflow Orchestration Essay', 'editor-source-action')
  assert(title, 'Open the fixture first note with no editor focused')
  key(81)
  await waitFor('Down must select the next note', (elements) => hasTitle(elements, title.frame, 'How I Run an Open Source Project'))
  key(82)
  await waitFor('Up must select the previous note', (elements) => hasTitle(elements, title.frame, title.AXLabel))
}

async function checkPaletteDismissal(initial) {
  assert(byId(initial, 'mobile-command-palette-input'), 'Open the palette first')
  key(41)
  await waitFor('Escape must close the palette', (elements) => !byId(elements, 'mobile-command-palette-input'))
}

async function checkPaletteSelection(initial) {
  assert(byId(initial, 'mobile-command-palette-input'), 'Open the unfiltered palette first')
  key(81)
  key(81)
  key(82)
  key(81)
  key(40)
  await waitFor('Return must execute the arrow-selected All Notes command', (elements) =>
    !byId(elements, 'mobile-command-palette-input') && toolbarTitle(elements, 'All Notes', 'note-list-search-action'))
}

function checkEditorOwnership(initial) {
  const title = toolbarTitle(initial, 'Workflow Orchestration Essay', 'editor-source-action')
  assert(title && byId(initial, 'editor-markdown-input'), 'Focus the fixture source editor first')
  key(81)
  assert(hasTitle(snapshot(), title.frame, title.AXLabel), 'Editor Down must not change the selected note')
  key(82)
  assert(hasTitle(snapshot(), title.frame, title.AXLabel), 'Editor Up must not change the selected note')
}

// Set up each screen using native clicks. This avoids AXe's rotation-dependent
// coordinate translation; the checks never invoke app handlers or inject JS.
const checks = new Map([
  ['notes', checkNoteNavigation], ['palette-dismiss', checkPaletteDismissal],
  ['palette-select', checkPaletteSelection], ['source', checkEditorOwnership],
])
const name = process.argv[2]
const check = checks.get(name)
assert(check, 'Choose notes, palette-dismiss, palette-select, or source')
await check(snapshot())
console.log(`PASS: native hardware keyboard ${name}`)
