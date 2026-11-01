import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { publishMobileUpdate } from './publish-mobile-update.mjs'

function environment(overrides = {}) {
  return { CIRCLE_BRANCH: 'main', MEMORIA_OTA_CHANNEL: 'alpha', MEMORIA_OTA_BASE_REF: 'HEAD~1',
    MEMORIA_OTA_RUNTIME: 'a'.repeat(40), MEMORIA_IOS_BUILD_NUMBER: '42', EXPO_TOKEN: 'test-only',
    SENTRY_AUTH_TOKEN: 'test-only', SENTRY_ORG: 'test-org', SENTRY_PROJECT: 'test-project',
    EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    EXPO_PUBLIC_POSTHOG_KEY: 'phc_test-only', EXPO_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com', ...overrides }
}

function executor(files, runtime = 'a'.repeat(40)) {
  const calls = []
  return {
    calls,
    execute(command, args, options) {
      calls.push({ command, args, options })
      if (['rev-parse', 'rev-list', 'merge-base'].includes(args[0])) return 'b'.repeat(40)
      if (args[0] === 'diff') return files.join('\0')
      if (args.includes('runtimeversion:resolve')) return JSON.stringify({ runtimeVersion: runtime })
      if (args[0] === 'update') return JSON.stringify([{ runtimeVersion: runtime, branch: options.channel,
        platform: 'ios', gitCommitHash: 'b'.repeat(40), group: 'cc862536-09bf-4dca-a6f5-a704699489c8' }])
      return ''
    },
  }
}

test('desktop-only changes never export, upload or publish a mobile update', () => {
  const run = executor(['src/components/NoteItem.tsx', 'src-tauri/src/lib.rs', 'docs/ARCHITECTURE.md'])
  assert.equal(publishMobileUpdate(environment({ MEMORIA_OTA_RUNTIME: '', MEMORIA_IOS_BUILD_NUMBER: '',
    EXPO_TOKEN: '', SENTRY_AUTH_TOKEN: '' }), run.execute).published, false)
  assert(run.calls.every(call => call.command === 'git'))
})

test('a missing push base checks all history rather than only the final commit', () => {
  const run = executor(['apps/mobile/src/App.tsx'])
  publishMobileUpdate(environment({ MEMORIA_OTA_BASE_REF: '' }), run.execute)
  const base = run.calls.find(call => call.args[0] === 'rev-list')
  assert(base, 'First publication must resolve the root commit')
  assert.deepEqual(base.args, ['rev-list', '--max-parents=0', 'HEAD'])
  assert(run.calls.every(call => !call.args.includes('HEAD~1^{commit}')))
})

test('a restored base must be an ancestor before any publishing side effect', () => {
  const run = executor(['apps/mobile/src/App.tsx'])
  assert.throws(() => publishMobileUpdate(environment(), (command, args, options) => {
    if (args[0] === 'merge-base') return 'c'.repeat(40)
    return run.execute(command, args, options)
  }), /ancestor/)
  assert(run.calls.every(call => call.command === 'git'))
})

for (const file of ['apps/mobile/src/App.tsx', 'src/shared/typeLabels.ts', 'src/lib/locales/en.json', 'pnpm-lock.yaml']) {
  test(`publishes mobile/shared change ${file} only after map upload`, () => {
    const run = executor([file])
    const result = publishMobileUpdate(environment(), run.execute)
    assert.equal(result.published, true)
    const upload = run.calls.findIndex(call => call.args.includes('sentry-cli'))
    const publish = run.calls.findIndex(call => call.args.includes('update'))
    assert(upload > 0 && publish > upload)
    assert(run.calls[upload].args.includes('--strict'))
    assert(run.calls[upload].args.includes('--wait-for'))
    assert(run.calls[upload].args.includes('hbc'))
    assert(run.calls[publish].args.includes('alpha'))
    assert(run.calls.every(call => !call.args.includes('test-only')))
    assert.equal(run.calls[publish].options.env.MEMORIA_BUILD_PROFILE, 'testflight')
    assert.equal(run.calls[publish].options.env.EXPO_PUBLIC_DISTRIBUTION, 'testflight')
    assert(run.calls.every(call => call.options.env.EXPO_NO_DOTENV === '1'))
  })
}

test('native incompatibility prevents export and every upload', () => {
  const run = executor(['apps/mobile/src/App.tsx'], 'c'.repeat(40))
  assert.throws(() => publishMobileUpdate(environment(), run.execute), /native runtime/)
  assert.equal(run.calls.some(call => call.args.includes('export') || call.args.includes('upload') || call.args.includes('update')), false)
})

test('source-map failure prevents publishing', () => {
  const run = executor(['apps/mobile/src/App.tsx'])
  const execute = (command, args, options) => {
    if (args.includes('sentry-cli')) throw new Error('controlled source-map failure')
    return run.execute(command, args, options)
  }
  assert.throws(() => publishMobileUpdate(environment(), execute), /source-map failure/)
  assert.equal(run.calls.some(call => call.args.includes('update')), false)
})

for (const key of ['EXPO_TOKEN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT',
  'EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_POSTHOG_KEY', 'EXPO_PUBLIC_POSTHOG_HOST']) {
  test(`requires private publishing credential ${key}`, () => {
    const run = executor(['apps/mobile/src/App.tsx'])
    assert.throws(() => publishMobileUpdate(environment({ [key]: '' }), run.execute), error => error instanceof Error && error.message.includes(key))
    assert.equal(run.calls.some(call => call.args.includes('export')), false)
  })
}

for (const receipt of ['', '{}', '[]',
  JSON.stringify([{ platform: 'ios', runtimeVersion: 'wrong', branch: 'alpha', gitCommitHash: 'b'.repeat(40) }]),
  JSON.stringify([{ platform: 'ios', runtimeVersion: 'a'.repeat(40), branch: 'stable', gitCommitHash: 'b'.repeat(40) }]),
  JSON.stringify([{ platform: 'android', runtimeVersion: 'a'.repeat(40), branch: 'alpha', gitCommitHash: 'b'.repeat(40) }]),
  JSON.stringify([{ platform: 'ios', runtimeVersion: 'a'.repeat(40), branch: 'alpha', gitCommitHash: 'c'.repeat(40) }]),
]) {
  test(`does not report success for a mismatched or malformed publishing receipt ${receipt}`, () => {
    const run = executor(['apps/mobile/src/App.tsx'])
    assert.throws(() => publishMobileUpdate(environment(), (command, args, options) => {
      const result = run.execute(command, args, options)
      return args[0] === 'update' ? receipt : result
    }))
  })
}

test('a feature branch cannot publish to alpha or stable', () => {
  const run = executor(['apps/mobile/src/App.tsx'])
  assert.throws(() => publishMobileUpdate(environment({ CIRCLE_BRANCH: 'mobile-ui-foundation' }), run.execute), /main/)
})

for (const overrides of [
  { MEMORIA_OTA_CHANNEL: 'unknown' }, { MEMORIA_OTA_CHANNEL: undefined },
  { MEMORIA_OTA_RUNTIME: 'not-a-native-fingerprint' }, { MEMORIA_OTA_RUNTIME: undefined },
  { MEMORIA_IOS_BUILD_NUMBER: '0' }, { MEMORIA_IOS_BUILD_NUMBER: undefined },
]) {
  test(`rejects invalid publishing target ${JSON.stringify(overrides)}`, () => {
    const run = executor(['apps/mobile/src/App.tsx'])
    assert.throws(() => publishMobileUpdate(environment(overrides), run.execute))
    assert.equal(run.calls.some(call => call.command !== 'git'), false)
  })
}

test('the real command runner safely skips an unchanged source commit', () => {
  assert.equal(publishMobileUpdate(environment({ MEMORIA_OTA_BASE_REF: 'HEAD' })).published, false)
})

test('validation is isolated and stable has store attribution', () => {
  for (const channel of ['stable', 'ota-validation']) {
    const run = executor(['apps/mobile/src/App.tsx'])
    const result = publishMobileUpdate(environment({ MEMORIA_OTA_CHANNEL: channel }), run.execute)
    assert.equal(result.channel, channel)
    const call = run.calls.at(-1)
    assert(call.args.includes(channel))
    assert.equal(call.options.env.EXPO_PUBLIC_DISTRIBUTION, channel === 'stable' ? 'store' : 'internal')
  }
})

for (const [channel, easEnvironment] of [['alpha', 'preview'], ['ota-validation', 'preview'], ['stable', 'production']]) {
  test(`publishes ${channel} with the explicit SDK 57 EAS environment`, () => {
    const run = executor(['apps/mobile/src/App.tsx'])
    publishMobileUpdate(environment({ MEMORIA_OTA_CHANNEL: channel }), run.execute)
    const publish = run.calls.at(-1)
    const index = publish.args.indexOf('--environment')
    assert(index >= 0, 'SDK 57 requires an explicit EAS environment')
    assert.equal(publish.args[index + 1], easEnvironment)
  })
}

test('manual OTA pipelines never start desktop release workflows', () => {
  const config = parse(readFileSync(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8'))
  assert.equal(config.parameters['publish-mobile-ota'].default, false)
  const flag = '<< pipeline.parameters.publish-mobile-ota >>'
  assert.equal(config.workflows['mobile-ota'].when, flag)
  assert.equal(config.workflows.validation.unless, flag)
  for (const workflow of ['alpha-release', 'stable-release']) {
    assert.deepEqual(config.workflows[workflow].when, { and: [
      '<< pipeline.parameters.run_release_workflows >>', { not: flag },
    ] })
  }
  const jobs = config.workflows['mobile-ota'].jobs
  const approval = jobs.find(job => job['approve-mobile-ota'])['approve-mobile-ota']
  assert.equal(approval.type, 'approval')
  assert(approval.requires.includes('static-gates'))
  assert(approval.requires.includes('frontend-coverage-report'))
  assert(approval.requires.includes('rust-coverage'))
  assert(approval.requires.includes('playwright-smoke-report'))
  assert(approval.requires.includes('mobile-ota-quality'))
  assert.deepEqual(jobs.find(job => job['mobile-ota-publish'])['mobile-ota-publish'].requires, ['approve-mobile-ota'])
  assert.equal(jobs.find(job => job['mobile-ota-publish'])['mobile-ota-publish'].channel,
    '<< pipeline.parameters.mobile-ota-channel >>')
})

test('main automatically publishes alpha only after all quality gates', () => {
  const config = parse(readFileSync(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8'))
  const jobs = config.workflows.validation.jobs
  const publish = jobs.find(job => job['mobile-ota-publish'])['mobile-ota-publish']
  assert.equal(publish.channel, 'alpha')
  assert.equal(publish.filters.branches.only, 'main')
  assert.equal(publish.filters.tags.ignore, '/.*/')
  assert.equal(publish['serial-group'], '<< pipeline.project.slug >>/mobile-ota-alpha')
  assert.deepEqual(publish.requires, ['static-gates', 'frontend-lint-build', 'frontend-coverage-report',
    'rust-coverage', 'rust-lint', 'playwright-smoke-report', 'mobile-ota-quality'])
  assert(!jobs.some(job => job['approve-mobile-ota']))
  assert.equal(jobs.find(job => job['mobile-ota-quality'])['mobile-ota-quality'].filters.branches.only, 'main')
})

test('stable publishing requires an explicit group and never rebuilds an update', () => {
  const config = parse(readFileSync(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8'))
  assert.equal(config.parameters['mobile-ota-group'].default, '')
  const job = config.jobs['mobile-ota-publish']
  const command = job.steps.flatMap(step => step.run?.command ?? []).join('\n')
  assert(command.includes('promote-mobile-update.mjs'))
  assert(command.includes('MEMORIA_ACCEPTED_ALPHA_RUNTIME'))
  assert(command.includes('MEMORIA_ACCEPTED_STABLE_RUNTIME'))
  assert(!command.includes('<< pipeline.git.base_revision >>'))
  assert(command.includes('/tmp/memoria-mobile-ota/alpha.sha'))
  assert.equal(job.environment.MEMORIA_OTA_GROUP, '<< pipeline.parameters.mobile-ota-group >>')
})

function configuredJob(job) {
  if (typeof job === 'string') return { key: job, settings: {} }
  const [key, settings] = Object.entries(job)[0]
  return { key, settings }
}

function assertWorkflowReferences(config, workflow) {
  const jobs = config.workflows[workflow].jobs.map(configuredJob)
  const names = new Set(jobs.map(({ key, settings }) => settings.name ?? key))
  for (const { key, settings } of jobs) {
    assert(settings.type === 'approval' || Object.hasOwn(config.jobs, key), `Missing job ${key}`)
    for (const required of settings.requires ?? []) assert(names.has(required), `Missing prerequisite ${required}`)
  }
}

test('every OTA prerequisite resolves to a real current job', () => {
  const config = parse(readFileSync(new URL('../../../.circleci/config.yml', import.meta.url), 'utf8'))
  for (const workflow of ['validation', 'mobile-ota']) assertWorkflowReferences(config, workflow)
})
