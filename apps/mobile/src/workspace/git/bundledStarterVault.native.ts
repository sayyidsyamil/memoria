import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
import manifest from '../../../assets/starter-vault/manifest.json'
import { starterImageSources } from '../../../assets/starter-vault/images'
import { populateStarterVaultFiles } from './starterVaultFiles.native'
import { prepareStarterVault } from './starterVaultStorage.native'

export function prepareBundledStarterVault() {
  return prepareStarterVault({
    label: manifest.label,
    revision: manifest.revision,
    populate: directory => {
      const sources = starterImageSources()
      return populateStarterVaultFiles(directory, {
        files: manifest.files,
        resolveAsset: path => resolvePackagedImage(sources[path]),
      })
    },
  })
}

async function resolvePackagedImage(source: number | undefined) {
  if (source === undefined) throw new Error('starterVaultBundleInvalid')
  let asset = Asset.fromModule(source)
  const packagedUri = localFileUri(asset)
  if (packagedUri) return new File(packagedUri)
  // Android drawable names are resources, not filesystem paths.
  if (!asset.uri.includes(':')) asset = Asset.fromURI(asset.uri)
  await asset.downloadAsync()
  if (!asset.localUri?.startsWith('file://')) throw new Error('starterVaultBundleInvalid')
  return new File(asset.localUri)
}

function localFileUri(asset: Asset) {
  if (asset.localUri?.startsWith('file://')) return asset.localUri
  return asset.uri.startsWith('file://') ? asset.uri : null
}
