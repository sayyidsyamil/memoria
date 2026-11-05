/* global module, require */
const assert = require('node:assert/strict')

function fileHookTransform(source, chunk, isEndOfFile) {
  if (source.type !== 'contents' || source.id !== 'expoConfig') return chunk
  assert(isEndOfFile, 'Expo configuration must arrive as one complete chunk')
  const config = JSON.parse(chunk.toString())
  const headers = config.updates?.requestHeaders
  const channel = headers?.['expo-channel-name']
  // Release routing is not a native ABI change; validation identities stay distinct.
  if (channel === 'alpha' || channel === 'stable') delete headers['expo-channel-name']
  return JSON.stringify(config)
}

module.exports = {
  sourceSkips: ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
  fileHookTransform,
}
