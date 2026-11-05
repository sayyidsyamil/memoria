import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function promoteMobileUpdate(environment, execute = executeCommand) {
  assert.equal(environment.CIRCLE_BRANCH, 'main', 'Stable promotion requires main')
  assert.equal(environment.MEMORIA_OTA_CHANNEL, 'stable', 'Promotion targets stable only')
  const group = environment.MEMORIA_OTA_GROUP
  const runtime = environment.MEMORIA_OTA_RUNTIME
  assert.match(group ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 'Select an explicit alpha update group')
  assert.match(runtime ?? '', /^[a-f0-9]{40,64}$/, 'Accepted stable native runtime is required')
  assert(environment.EXPO_TOKEN?.trim(), 'EXPO_TOKEN is required for promotion')
  const command = environment.MEMORIA_EAS_CLI || 'eas'
  const options = { cwd: fileURLToPath(new URL('../', import.meta.url)), env: environment }
  const updates = JSON.parse(execute(command, ['update:view', group, '--json'], options))
  validateArtifact(updates, group, runtime)
  execute(command, ['update:republish', '--group', group, '--destination-channel', 'stable',
    '--platform', 'ios', '--message', `Promote tested alpha ${group}`, '--non-interactive', '--json'], options)
  return { promoted: true, channel: 'stable', group, runtime }
}

function validateArtifact(updates, group, runtime) {
  assert(Array.isArray(updates), 'Invalid update group response')
  const ios = updates.filter(update => update.platform === 'ios')
  assert.equal(ios.length, 1, 'Exactly one iOS update is required')
  const update = ios[0]
  assert.equal(update.group, group, 'Update group mismatch')
  assert.equal(update.branch, 'alpha', 'Only a tested alpha artifact can be promoted')
  assert.equal(update.runtimeVersion, runtime, 'Install and accept a compatible stable binary first')
  assert.equal(update.isRollBackToEmbedded, false, 'A rollback is not a promotion candidate')
}

function executeCommand(command, args, options) {
  return execFileSync(command, args, { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 8 * 1024 * 1024 })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(promoteMobileUpdate(process.env)))
}
