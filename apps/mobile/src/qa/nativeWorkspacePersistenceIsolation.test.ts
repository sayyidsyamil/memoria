import { expect, it } from 'vitest'
import { nativeWorkspacePersistenceProbeRequest } from './nativeWorkspacePersistenceProbeRepository'
import { nativeWorkspacePersistenceProbeVaultLabel } from './nativeWorkspacePersistenceProbe'
import { nativeWysiwygPersistenceProbeRequest } from './nativeWysiwygPersistenceProbeRepository'
import { nativeWysiwygPersistenceProbeVaultLabel } from './nativeWysiwygPersistenceProbe'

const probes = [
  { name: 'workspace', request: nativeWorkspacePersistenceProbeRequest, label: nativeWorkspacePersistenceProbeVaultLabel },
  { name: 'WYSIWYG', request: nativeWysiwygPersistenceProbeRequest, label: nativeWysiwygPersistenceProbeVaultLabel },
].flatMap(probe => ['file:///existing-user-vault', undefined].map(vaultRootUri => ({ ...probe, vaultRootUri })))

it.each(probes)(
  'does not use a selected vault as a $name probe fallback when the native filesystem is unavailable ($vaultRootUri)',
  ({ request, label, vaultRootUri }) => {
    // Node has no Expo native filesystem; native-root resolution must fail closed.
    expect(request({ source: 'native', vaultRootUri })).toMatchObject({
      source: 'native',
      vaultLabel: label,
      vaultRootUri: null,
    })
  },
)

it.each(probes.filter(probe => probe.vaultRootUri !== undefined))(
  'does not reuse an existing vault index or alias in the $name disposable root',
  ({ request }) => {
    const workspaceIndex = { directories: ['Private'], files: [] }
    const original = { source: 'native' as const, vaultAlias: 'private-vault', vaultRootUri: 'file:///private', workspaceIndex }
    expect(request(original)).toMatchObject({ vaultRootUri: null, vaultAlias: null, workspaceIndex: undefined })
    expect(original.workspaceIndex).toBe(workspaceIndex)
    expect(original.vaultAlias).toBe('private-vault')
  },
)
