import { copyAsync } from 'expo-file-system/legacy'

let rendererUri: Promise<string> | null = null

export async function copyMobileDiagramRenderer(rootUri: string): Promise<void> {
  rendererUri ??= loadRendererUri().catch((error: unknown) => { rendererUri = null; throw error })
  await copyAsync({ from: await rendererUri, to: `${rootUri}diagram-renderer.html` })
}

async function loadRendererUri(): Promise<string> {
  const { Asset } = await import('expo-asset')
  const { default: source } = await import('../../../assets/diagram-renderer.html')
  const asset = Asset.fromModule(source)
  await asset.downloadAsync()
  if (!asset.localUri) throw new Error('Offline diagram renderer unavailable')
  return asset.localUri
}
