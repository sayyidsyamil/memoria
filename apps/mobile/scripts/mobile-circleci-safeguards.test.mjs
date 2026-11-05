import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

const config = parse(readFileSync(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8'))

test('large changed-file previews drain input without failing under pipefail', () => {
  const preview = config.commands.skip_unless_changed.steps.at(-1).run.command
    .split('\n').find(line => line.includes("printf '%s\\n'"))
  assert.ok(preview, 'The checked preview must come from the actual CI command')
  const input = Array.from({ length: 20000 }, (_, index) => `apps/mobile/src/long-path-${index}.tsx`).join('\n')
  const result = spawnSync('bash', ['-c', `set -euo pipefail\nrelevant=$(cat)\n${preview}`], { input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 20)
})

test('mobile and browser executors use the same Node release with default TypeScript stripping', () => {
  const image = config.executors.node.docker[0].image
  const match = /^cimg\/node:(\d+)\.(\d+)\.(\d+)$/.exec(image)
  assert.ok(match, 'Use an explicit official Node image version')
  const [major, minor] = match.slice(1).map(Number)
  assert.ok(major > 22 || major === 22 && minor >= 18, 'Mobile QA scripts require default TypeScript stripping')
  assert.equal(config.executors.browser.docker[0].image, `${image}-browsers`)
})
