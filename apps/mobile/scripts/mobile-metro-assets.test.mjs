import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const sdk = createRequire(require.resolve('expo/metro-config'))
const { getAssetData } = sdk('metro/private/Assets')

test('Expo Metro resolves the bundled starter image with its real file-path API', async () => {
  const file = fileURLToPath(new URL('../assets/starter-vault/images/41c60644a692ff6ea4ee39d85f38b13cdcfd278e1074cd19c3e4da233afe0f80.png', import.meta.url))
  const result = await getAssetData(file, 'starter-image.png', [], 'ios', '/assets')
  assert.equal(result.width, 760)
  assert.equal(result.height, 408)
  assert.equal(result.type, 'png')
  assert.deepEqual(result.files, [file])
})
