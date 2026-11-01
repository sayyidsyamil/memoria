export type ManagedLocalVault = { id: string; label: string; directory: string }

export function isManagedLocalDirectory(value: string) {
  return value === 'Memoria Vault' || /^Local Vaults\/[a-z0-9-]{1,80}$/u.test(value)
}

export function parseManagedLocalVaults(value: unknown): ManagedLocalVault[] {
  if (!Array.isArray(value)) throw new Error('vaultCatalogInvalid')
  const vaults = value.map(parseLocalVault)
  if (new Set(vaults.map(vault => vault.id)).size !== vaults.length) throw new Error('vaultCatalogInvalid')
  return vaults
}

function parseLocalVault(entry: unknown): ManagedLocalVault {
  if (!entry || typeof entry !== 'object') throw new Error('vaultCatalogInvalid')
  const value = entry as Partial<ManagedLocalVault>
  const id = requiredText(value.id)
  const label = requiredText(value.label)
  const directory = requiredText(value.directory)
  if (!/^[a-z0-9-]{1,80}$/u.test(id)) throw new Error('vaultCatalogInvalid')
  if (!isManagedLocalDirectory(directory)) throw new Error('vaultCatalogInvalid')
  return { id, label, directory }
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('vaultCatalogInvalid')
  return value
}
