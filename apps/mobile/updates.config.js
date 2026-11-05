/* global module */
const easProjectId = 'ec8f7035-5dea-4264-8e40-8cdf0d5cb377'

function updateConfiguration(profile, requestedChannel) {
  const channel = { testflight: 'alpha', production: 'stable', 'ota-validation': 'ota-validation' }[profile]
  if (requestedChannel && requestedChannel !== channel) {
    throw new Error('MEMORIA_UPDATE_CHANNEL must match the build profile')
  }
  if (!channel) return { enabled: false }
  return {
    enabled: true,
    url: `https://u.expo.dev/${easProjectId}`,
    requestHeaders: { 'expo-channel-name': channel },
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    useEmbeddedUpdate: true,
    disableAntiBrickingMeasures: false,
  }
}

module.exports = { easProjectId, updateConfiguration }
