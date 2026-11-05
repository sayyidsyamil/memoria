import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { fileHookTransform, sourceSkips } = createRequire(import.meta.url)('../fingerprint.config.js')
const source = { type: 'contents', id: 'expoConfig' }
function configuration(channel) {
  return { ios: { bundleIdentifier: 'md.memoria.mobile', infoPlist: { UIFileSharingEnabled: true } },
    updates: { enabled: true, url: 'https://u.expo.dev/project', disableAntiBrickingMeasures: false,
      requestHeaders: { 'expo-channel-name': channel, 'another-header': 'kept' } },
    plugins: [['native-plugin', { nativeOption: true }]] }
}
const transformed = config => fileHookTransform(source, JSON.stringify(config), true)

test('Alpha and Stable routing share compatibility without changing app configuration', () => {
  const alpha = configuration('alpha')
  const original = structuredClone(alpha)
  assert.equal(transformed(alpha), transformed(configuration('stable')))
  assert.deepEqual(alpha, original)
})

test('build versions use Expo’s supported skip while preserving its default script skip', () => {
  assert.deepEqual(sourceSkips, ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'])
})

for (const channel of ['ota-validation', 'development', 'unknown']) {
  test(`keeps ${channel} distinct from release routing`, () => {
    assert.notEqual(transformed(configuration(channel)), transformed(configuration('alpha')))
    assert.equal(JSON.parse(transformed(configuration(channel))).updates.requestHeaders['expo-channel-name'], channel)
  })
}

test('keeps every non-channel native configuration input', () => {
  const config = configuration('alpha')
  const expected = structuredClone(config)
  delete expected.updates.requestHeaders['expo-channel-name']
  assert.deepEqual(JSON.parse(transformed(config)), expected)
})

for (const change of [
  config => { config.ios.bundleIdentifier = 'different.app' },
  config => { config.ios.infoPlist.UIFileSharingEnabled = false },
  config => { config.updates.url = 'https://different.example/update' },
  config => { config.updates.disableAntiBrickingMeasures = true },
  config => { config.updates.requestHeaders['another-header'] = 'different' },
  config => { config.plugins = [['different-native-plugin']] },
]) {
  test(`native compatibility inputs remain sensitive: ${change.toString()}`, () => {
    const config = configuration('alpha')
    const before = transformed(config)
    change(config)
    assert.notEqual(transformed(config), before)
  })
}

test('does not normalize other source contents or file buffers', () => {
  const chunk = Buffer.from('native source')
  assert.equal(fileHookTransform({ type: 'file', filePath: 'ios/Native.swift' }, chunk, false), chunk)
  assert.equal(fileHookTransform({ type: 'contents', id: 'other-config' }, chunk, true), chunk)
})

test('rejects incomplete or invalid Expo configuration instead of hiding a hash failure', () => {
  assert.throws(() => fileHookTransform(source, '{}', false))
  assert.throws(() => fileHookTransform(source, 'not-json', true))
})

test('handles disabled updates and preserves request headers without a channel', () => {
  for (const config of [{ updates: { enabled: false } }, {}]) {
    assert.deepEqual(JSON.parse(transformed(config)), config)
  }
})
