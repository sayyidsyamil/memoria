/* global process */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./capture-ios-simulator.mjs', import.meta.url))
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const simulatorTool = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
if (args[1] === 'list') {
  console.log(JSON.stringify({ devices: { runtime: [{ udid: 'owned-device', name: 'Owned iPad' }] } }))
} else if (args[1] === 'openurl') {
  fs.appendFileSync(process.env.CAPTURE_CALLS, JSON.stringify({ url: args[3] }) + '\\n')
} else if (args[1] === 'io' && args[3] === 'screenshot') {
  fs.appendFileSync(process.env.CAPTURE_CALLS, JSON.stringify({ output: args[4] }) + '\\n')
  if (!args[4].startsWith(process.env.CAPTURE_TEMP + path.sep)) throw Error('Native service cannot write to destination')
  if (process.env.CAPTURE_FAIL === '1') throw Error('Synthetic capture failure')
  fs.writeFileSync(args[4], Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
} else { throw Error('Unexpected simulator operation') }
`

test('stages framebuffer bytes locally before copying to the requested destination', t => {
  const fixture = captureFixture(t)
  const result = fixture.run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(fixture.output), image)
  const capture = fixture.calls().find(call => call.output)
  assert.notEqual(capture.output, fixture.output)
  assert.equal(existsSync(dirname(capture.output)), false)
  assert.deepEqual(readdirSync(fixture.nativeTemp), [])
})

test('a failed native capture preserves the existing destination and removes staging', t => {
  const fixture = captureFixture(t)
  writeFileSync(fixture.output, 'previous screenshot')
  assert.notEqual(fixture.run({ environment: { CAPTURE_FAIL: '1' } }).status, 0)
  assert.equal(readFileSync(fixture.output, 'utf8'), 'previous screenshot')
  assert.deepEqual(readdirSync(fixture.nativeTemp), [])
})

test('places a native QA query before the deep-link fragment without losing other parameters', t => {
  const fixture = captureFixture(t)
  const result = fixture.run({ target: join(fixture.nativeTemp, 'screen.png'),
    args: ['--open-url', 'memoria://qa?source=native-vault#editor'] })
  assert.equal(result.status, 0, result.stderr)
  const urls = fixture.calls().filter(call => call.url).map(call => new URL(call.url))
  assert.equal(urls.length, 2)
  for (const url of urls) {
    assert.equal(url.searchParams.get('source'), 'native-vault')
    assert.match(url.searchParams.get('qaRun'), /^\d+(?:-reset)?$/u)
    assert.equal(url.hash, '#editor')
  }
})

function captureFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'memoria-capture-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'), nativeTemp = join(root, 'native-temp'), destination = join(root, 'destination')
  for (const directory of [bin, nativeTemp, destination]) mkdirSync(directory)
  writeFileSync(join(bin, 'xcrun'), simulatorTool, { mode: 0o700 })
  const output = join(destination, 'screen.png'), callsFile = join(root, 'calls.jsonl')
  return {
    output, nativeTemp,
    calls: () => readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    run: ({ args = [], environment = {}, target = output } = {}) => spawnSync(process.execPath, [script,
      '--device', 'owned-device', '--out', target, '--wait', '0', ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
        TMPDIR: nativeTemp, CAPTURE_TEMP: nativeTemp, CAPTURE_CALLS: callsFile, ...environment },
    }),
  }
}
