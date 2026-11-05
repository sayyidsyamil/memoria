#!/usr/bin/env node
// Regenerates the desktop parity goldens (TOL-228) in apps/server/test/fixtures/desktop-parity:
//  1. steps.json: the scripted web edits run through the web client and the server;
//  2. entries.json: the desktop's reading of the vault after every step (scan_vault).
// Then runs both suites once more without regenerating. Review the diff before committing:
// a change in either file is a change in what the web writes or the desktop reads.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const WEB_SUITE = ['vitest', 'run', '--config', 'apps/server/vitest.config.ts', 'apps/server/test/desktopParity.test.ts']
const DESKTOP_SUITE = ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--test', 'web_desktop_parity']

function run(command, args, regenerate) {
  const env = { ...process.env, REGENERATE_GOLDEN: regenerate ? '1' : '0' }
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npx', WEB_SUITE, true)
run('cargo', DESKTOP_SUITE, true)
run('npx', WEB_SUITE, false)
run('cargo', DESKTOP_SUITE, false)
