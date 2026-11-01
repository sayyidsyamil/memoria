/* global module, process, require */
const { withSentry } = require('@sentry/react-native/expo')
const { easProjectId, updateConfiguration } = require('./updates.config.js')

module.exports = ({ config }) => withSentry({
  ...config,
  owner: 'refactoring',
  runtimeVersion: { policy: 'fingerprint' },
  updates: updateConfiguration(process.env.MEMORIA_BUILD_PROFILE, process.env.MEMORIA_UPDATE_CHANNEL),
  plugins: [...(config.plugins || []), ['expo-build-properties', { ios: { enableSceneSupport: true } }]],
  ios: iosBuildConfiguration(config.ios),
  android: androidBuildConfiguration(config.android),
  extra: {
    ...config.extra,
    eas: { ...config.extra?.eas, projectId: easProjectId },
    // Only public ingestion credentials belong in the application manifest.
    telemetry: {
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || process.env.VITE_SENTRY_DSN || '',
      posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY || process.env.VITE_POSTHOG_KEY || '',
      posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST || process.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    },
  },
}, { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT })

function iosBuildConfiguration(ios) {
  const profile = process.env.MEMORIA_BUILD_PROFILE
  if (profile === undefined || profile === 'development') return ios
  if (profile === 'ota-validation') return { ...ios, bundleIdentifier: 'md.memoria.mobile.ota-validation' }
  const distribution = { testflight: 'testflight', production: 'store' }[profile]
  if (!distribution) {
    throw new Error('MEMORIA_BUILD_PROFILE must be development, testflight, production or ota-validation')
  }
  requireEnvironmentValue('EXPO_PUBLIC_DISTRIBUTION', distribution)
  requireEnvironmentValue('EXPO_PUBLIC_RELEASE_CHANNEL', profile === 'testflight' ? 'alpha' : 'stable')
  return {
    ...ios,
    bundleIdentifier: 'md.memoria.mobile',
    appleTeamId: 'D84V3C272P',
    buildNumber: testFlightBuildNumber(),
  }
}

function androidBuildConfiguration(android) {
  if (process.env.MEMORIA_BUILD_PROFILE !== 'ota-validation') return android
  return { ...android, package: 'md.memoria.mobile.ota_validation' }
}

function testFlightBuildNumber() {
  const number = process.env.MEMORIA_IOS_BUILD_NUMBER || ''
  if (!/^[1-9][0-9]{0,3}$/.test(number)) {
    throw new Error('MEMORIA_IOS_BUILD_NUMBER must be an integer from 1 to 9999')
  }
  return number
}

function requireEnvironmentValue(key, expected) {
  if (process.env[key] !== expected) {
    throw new Error(`${key} must be ${expected} for the TestFlight profile`)
  }
}
