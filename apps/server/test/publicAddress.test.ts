import { describe, expect, it } from 'vitest'
import { isPublicAddress, urlHost } from '../src/publicAddress.ts'

// TOL-204 / TOL-207: the remote image import and the R2 endpoints only reach public hosts.

describe('which addresses count as public', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    '2001:db8::1',
    '2002:7f00:1::1',
    'not-an-address',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
})

describe('urlHost', () => {
  it.each([
    ['https://example.com/a', 'example.com'],
    ['http://127.0.0.1:9000', '127.0.0.1'],
    ['http://[::1]:9000/bucket', '::1'],
  ])('reads %s as %s', (url, host) => {
    expect(urlHost(new URL(url))).toBe(host)
  })
})
