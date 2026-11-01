import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
assert.equal(readJson('package.json').name, 'memoria')
const config = readJson('src-tauri/tauri.conf.json')
assert.equal(config.productName, 'Memoria')
assert.equal(config.identifier, 'my.memoria.workspace')
assert.deepEqual(config.plugins['deep-link'].desktop.schemes, ['memoria'])
assert.equal(config.bundle.createUpdaterArtifacts, false)

let checked = 0
const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.svg', '.css', '/index.ts', '/index.tsx']
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(absolute)
      continue
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue
    const source = fs.readFileSync(absolute, 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]*memoria[^'"]*)['"]/gi)) {
      const imported = match[1]
      if (!imported.startsWith('.')) continue
      const target = path.resolve(path.dirname(absolute), imported)
      assert(extensions.some(extension => fs.existsSync(target + extension)), `Missing renamed import ${imported} in ${absolute}`)
      checked++
    }
  }
}
walk(path.join(root, 'src'))
walk(path.join(root, 'tests'))
console.log(`Memoria identity configuration and ${checked} renamed relative imports verified.`)
