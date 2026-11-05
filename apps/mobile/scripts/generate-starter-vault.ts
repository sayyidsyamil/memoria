import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'
import { generateStarterBundle } from './starterVaultBundle.ts'

const [, , repository, revision] = argv
if (!repository || !revision) throw new Error('Usage: node scripts/generate-starter-vault.ts <repository> <commit-sha>')
const outputDirectory = fileURLToPath(new URL('../assets/starter-vault/', import.meta.url))
const manifest = generateStarterBundle({ repository, revision, outputDirectory })
console.log(`Bundled ${manifest.files.length} starter files from ${manifest.revision}`)
