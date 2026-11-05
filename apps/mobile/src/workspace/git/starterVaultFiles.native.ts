import { Buffer } from 'buffer'
import { CryptoDigestAlgorithm, digest } from 'expo-crypto'
import { type Directory, File } from 'expo-file-system'

type StarterFile = { path: string; sha256: string; text?: string; asset?: string }
type StarterFiles = {
  files: readonly StarterFile[]
  resolveAsset: (relativePath: string) => Promise<File>
}

// The caller owns this staging directory; published vaults never enter this path.
export async function populateStarterVaultFiles(directory: Directory, source: StarterFiles) {
  validateFiles(source.files)
  for (const entry of source.files) {
    await copyFile(directory, entry, source.resolveAsset)
  }
}

async function copyFile(directory: Directory, entry: StarterFile, resolveAsset: StarterFiles['resolveAsset']) {
  const target = new File(directory, entry.path)
  if (target.exists && await checksum(target) === entry.sha256) return
  target.parentDirectory.create({ intermediates: true, idempotent: true })
  if (target.exists) target.delete()
  if (entry.text !== undefined) target.write(entry.text)
  else (await resolveAsset(entry.path)).copy(target)
  if (await checksum(target) !== entry.sha256) throw new Error('starterVaultBundleInvalid')
}

async function checksum(file: File) {
  const bytes = await file.bytes()
  return Buffer.from(await digest(CryptoDigestAlgorithm.SHA256, bytes)).toString('hex')
}

function validateFiles(files: readonly StarterFile[]) {
  if (files.length === 0 || new Set(files.map(file => file.path)).size !== files.length) {
    throw new Error('starterVaultBundleInvalid')
  }
  for (const file of files) validateFile(file)
}

function validateFile(file: StarterFile) {
  const hasText = typeof file.text === 'string'
  const hasAsset = typeof file.asset === 'string' && file.asset.length > 0
  if (hasText === hasAsset) throw new Error('starterVaultBundleInvalid')
  if (!/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error('starterVaultBundleInvalid')
  if (!validPath(file.path)) throw new Error('starterVaultBundleInvalid')
}

function validPath(path: string) {
  return path.split('/').every(segment => !['', '.', '..', '.git'].includes(segment))
    && [...path].every(character => character >= ' ' && character !== '\u007f' && character !== '\\')
}
