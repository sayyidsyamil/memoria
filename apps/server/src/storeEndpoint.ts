import { isIP } from 'node:net'
import type { ServerConfig } from './config.ts'
import { type AddressResolver, isPublicAddress, systemResolver, urlHost } from './publicAddress.ts'

/**
 * The R2/S3 endpoints are operator configuration, but a typo or a tampered environment could
 * still point the signed store requests at an internal service. So the server checks them at
 * startup (TOL-207): an endpoint must be, or resolve only to, public addresses, unless
 * `MEMORIA_R2_ALLOW_PRIVATE_ENDPOINT=1` is set for a local MinIO in development. This fails
 * fast with a clear message; `R2BlobStore` then checks every connection's address again.
 */

async function resolvedAddresses(host: string, resolveHost: AddressResolver): Promise<string[]> {
  try {
    return (await resolveHost(host)).map(({ address }) => address)
  } catch {
    throw new Error(`MEMORIA_R2_ENDPOINT host ${host} could not be resolved`)
  }
}

/** Throws unless the endpoint's host is a public address or resolves to public addresses only. */
export async function assertPublicEndpoint(endpoint: string, resolveHost: AddressResolver = systemResolver): Promise<void> {
  const host = urlHost(new URL(endpoint))
  const addresses = isIP(host) === 0 ? await resolvedAddresses(host, resolveHost) : [host]
  if (addresses.length === 0) throw new Error(`MEMORIA_R2_ENDPOINT host ${host} resolves to no address`)
  const refused = addresses.find((address) => !isPublicAddress(address))
  if (refused === undefined) return
  throw new Error(
    `MEMORIA_R2_ENDPOINT host ${host} is the private, loopback, link-local or metadata address ${refused}; ` +
      'set MEMORIA_R2_ALLOW_PRIVATE_ENDPOINT=1 only for a local S3 server in development',
  )
}

/** The endpoints the configured blob store and index snapshots send requests to. */
export function storeEndpoints(config: Pick<ServerConfig, 'blobStore' | 'indexSnapshots'>): string[] {
  const endpoints = new Set<string>()
  if (config.blobStore.type === 'r2') endpoints.add(config.blobStore.config.endpoint)
  if (config.indexSnapshots) endpoints.add(config.indexSnapshots.r2.endpoint)
  return [...endpoints]
}

/** Run before any store request: refuses non-public endpoints unless development allowed them. */
export async function checkStoreEndpoints(
  config: Pick<ServerConfig, 'blobStore' | 'indexSnapshots' | 'allowPrivateR2Endpoint'>,
  resolveHost: AddressResolver = systemResolver,
): Promise<void> {
  if (config.allowPrivateR2Endpoint) return
  for (const endpoint of storeEndpoints(config)) await assertPublicEndpoint(endpoint, resolveHost)
}
