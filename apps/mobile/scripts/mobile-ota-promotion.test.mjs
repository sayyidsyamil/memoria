import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promoteMobileUpdate } from './promote-mobile-update.mjs'

const group = 'd85cbbce-01aa-4bfe-a7fb-a70b2e64d536'
const runtime = 'a'.repeat(40)
function environment(overrides = {}) {
  return { CIRCLE_BRANCH: 'main', MEMORIA_OTA_CHANNEL: 'stable', MEMORIA_OTA_GROUP: group,
    MEMORIA_OTA_RUNTIME: runtime, EXPO_TOKEN: 'test-only', ...overrides }
}
function executor(overrides = {}) {
  const calls = []
  return { calls, execute(command, args, options) {
    calls.push({ command, args, options })
    return JSON.stringify([{ group, branch: 'alpha', platform: 'ios', runtimeVersion: runtime,
      isRollBackToEmbedded: false, gitCommitHash: 'b'.repeat(40), ...overrides }])
  } }
}

test('promotion republishes the exact tested alpha group without exporting or changing alpha', () => {
  const run = executor()
  const result = promoteMobileUpdate(environment(), run.execute)
  assert.equal(result.group, group)
  assert.equal(result.runtime, runtime)
  assert.deepEqual(run.calls.map(call => call.args[0]), ['update:view', 'update:republish'])
  const publish = run.calls[1]
  assert(publish.args.includes('--group') && publish.args.includes(group))
  assert(publish.args.includes('--destination-channel') && publish.args.includes('stable'))
  assert(publish.args.includes('--platform') && publish.args.includes('ios'))
  assert(!publish.args.includes('test-only'))
})

for (const overrides of [{ CIRCLE_BRANCH: 'feature' }, { MEMORIA_OTA_CHANNEL: 'alpha' },
  { MEMORIA_OTA_GROUP: '' }, { MEMORIA_OTA_GROUP: '--bad-option' }, { MEMORIA_OTA_RUNTIME: '' },
  { EXPO_TOKEN: '' }]) {
  test(`refuses invalid promotion target ${JSON.stringify(overrides)}`, () => {
    const run = executor()
    assert.throws(() => promoteMobileUpdate(environment(overrides), run.execute))
    assert.equal(run.calls.length, 0)
  })
}

for (const overrides of [{ branch: 'stable' }, { branch: 'ota-validation' }, { group: 'wrong' },
  { platform: 'android' }, { runtimeVersion: 'c'.repeat(40) }, { isRollBackToEmbedded: true }]) {
  test(`refuses an unaccepted alpha artifact ${JSON.stringify(overrides)}`, () => {
    const run = executor(overrides)
    assert.throws(() => promoteMobileUpdate(environment(), run.execute))
    assert.equal(run.calls.length, 1)
  })
}

test('a failed group lookup or malformed response never publishes', () => {
  for (const response of ['', '{}', '[]']) {
    const run = executor()
    assert.throws(() => promoteMobileUpdate(environment(), (command, args, options) => {
      run.execute(command, args, options)
      return response
    }))
    assert.equal(run.calls.length, 1)
  }
  assert.throws(() => promoteMobileUpdate(environment(), () => { throw new Error('lookup failed') }), /lookup failed/)
})
