#!/usr/bin/env node
/* global console, process */

import { spawnSync } from 'node:child_process'

const tabletScripts = [
  'mobile:qa:ios-workspace-persistence',
  'mobile:qa:ios-action-adapters',
  'mobile:qa:ios-command-palette',
  'mobile:qa:ios-source-selection',
  'mobile:qa:ios-wysiwyg-mutation',
  'mobile:qa:ios-wysiwyg-persistence',
  'mobile:qa:ios-wysiwyg-autocomplete',
  'mobile:qa:ios-wysiwyg-format',
  'mobile:qa:ios-wysiwyg-table-commands',
  'mobile:qa:ios-wysiwyg-input-transforms',
  'mobile:qa:ios-wysiwyg-markdown-blocks',
  'mobile:qa:ios-wysiwyg-wikilink',
  'mobile:qa:ios-wysiwyg-external-link',
  'mobile:qa:ios-table-of-contents',
]

const phoneScripts = [
  'mobile:qa:ios-phone-workspace-persistence',
  'mobile:qa:ios-phone-action-adapters',
  'mobile:qa:ios-phone-command-palette',
  'mobile:qa:ios-phone-source-selection',
  'mobile:qa:ios-phone-wysiwyg-mutation',
  'mobile:qa:ios-phone-wysiwyg-persistence',
  'mobile:qa:ios-phone-wysiwyg-autocomplete',
  'mobile:qa:ios-phone-wysiwyg-format',
  'mobile:qa:ios-phone-wysiwyg-table-commands',
  'mobile:qa:ios-phone-wysiwyg-input-transforms',
  'mobile:qa:ios-phone-wysiwyg-markdown-blocks',
  'mobile:qa:ios-phone-wysiwyg-wikilink',
  'mobile:qa:ios-phone-wysiwyg-external-link',
]

function printHelp() {
  console.log(`Run native Expo/iOS Simulator editing QA probes.

Usage:
  node apps/mobile/scripts/assert-ios-editing-qa.mjs [options]

Options:
  --tablet    Run only iPad/tablet editing probes.
  --phone     Run only iPhone/phone editing probes.
  --help      Show this help.

The simulator and Metro server must already be running. Start them with
\`pnpm mobile:ios\`, then run this script from the repository root.
`)
}

function requestedScripts(args) {
  if (args.includes('--help')) return null

  const tabletOnly = args.includes('--tablet')
  const phoneOnly = args.includes('--phone')
  if (tabletOnly && phoneOnly) {
    throw new Error('Use either --tablet or --phone, not both.')
  }
  if (tabletOnly) return tabletScripts
  if (phoneOnly) return phoneScripts

  return [...tabletScripts, ...phoneScripts]
}

function runScript(script) {
  console.log(`\n▶ ${script}`)
  const result = spawnSync('pnpm', [script], { stdio: 'inherit' })
  if (result.status === 0) return

  throw new Error(`${script} failed with exit ${result.status ?? 'unknown'}.`)
}

function main() {
  const scripts = requestedScripts(process.argv.slice(2))
  if (scripts === null) {
    printHelp()
    return
  }

  scripts.forEach(runScript)
  console.log('\nNative iOS editing QA passed.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
