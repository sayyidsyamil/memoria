import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'

/**
 * Which addresses the server may connect to on someone else's say-so: the remote image
 * import (TOL-204) and the configured R2/S3 endpoints (TOL-207) only go to public hosts.
 */

/** Whether the server may connect to an address. Tests swap it to reach a loopback fixture. */
export type AddressPolicy = (address: string) => boolean

/** Private, loopback, link-local (cloud metadata included), shared, reserved and multicast. */
const NON_PUBLIC_IPV4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]
/** IPv6 is allowed in global unicast only, minus the ranges that tunnel to or document other hosts. */
const NON_PUBLIC_GLOBAL_IPV6: ReadonlyArray<[string, number]> = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
]

function blockList(ranges: ReadonlyArray<[string, number]>, family: 'ipv4' | 'ipv6'): BlockList {
  const list = new BlockList()
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, family)
  return list
}

const IPV4_DENIED = blockList(NON_PUBLIC_IPV4, 'ipv4')
const IPV6_GLOBAL = blockList([['2000::', 3]], 'ipv6')
const IPV6_DENIED = blockList(NON_PUBLIC_GLOBAL_IPV6, 'ipv6')

/** True only for a public unicast address. Mapped, loopback, ULA and link-local IPv6 are all outside 2000::/3. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !IPV4_DENIED.check(address, 'ipv4')
  if (family === 6) return IPV6_GLOBAL.check(address, 'ipv6') && !IPV6_DENIED.check(address, 'ipv6')
  return false
}

/** A URL's host as `isIP` reads it: an IPv6 literal loses its brackets. */
export function urlHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, '')
}

/** Whether a URL names an IP literal the policy refuses: those are connected to without a lookup. */
export function isRefusedLiteral(url: URL, isAllowedAddress: AddressPolicy): boolean {
  const host = urlHost(url)
  return isIP(host) !== 0 && !isAllowedAddress(host)
}

/** Every address a host name resolves to. Tests swap it for a fixed answer. */
export type AddressResolver = (hostname: string, family?: number) => Promise<LookupAddress[]>

export const systemResolver: AddressResolver = (hostname, family = 0) => lookup(hostname, { all: true, family })

type LookupCallback = (error: Error | null, address: string | LookupAddress[], family?: number) => void

/**
 * Resolves like the default lookup, then refuses the whole host when any address is not allowed.
 * Given as a request's `lookup`, it pins the socket to the checked address, so DNS cannot rebind it.
 */
export function guardedLookup(isAllowedAddress: AddressPolicy, refusal: () => Error, resolve = systemResolver): LookupFunction {
  const answer = (addresses: LookupAddress[], all: boolean | undefined, callback: LookupCallback) => {
    const allowed = addresses.length > 0 && addresses.every(({ address }) => isAllowedAddress(address))
    if (!allowed) return callback(refusal(), '')
    if (all) return callback(null, addresses)
    return callback(null, addresses[0].address, addresses[0].family)
  }
  const guarded = (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => {
    resolve(hostname, options.family).then(
      (addresses) => answer(addresses, options.all, callback),
      (error: Error) => callback(error, ''),
    )
  }
  return guarded as unknown as LookupFunction
}
