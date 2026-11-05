import { connect } from 'node:net'
import { expect, it, vi } from 'vitest'
import { withNativeSimulatorLease } from './nativeSimulatorLease'

it('returns the operation result and releases the port afterwards', async () => {
  let port = 0
  expect(await withNativeSimulatorLease(async (boundPort) => {
    port = boundPort
    return 'proof'
  }, 0)).toBe('proof')
  expect(port).toBeGreaterThan(0)
  expect(await withNativeSimulatorLease(async () => 'next', port)).toBe('next')
})

it('rejects a concurrent run before invoking its simulator operation', async () => {
  const operation = vi.fn(async () => 'must not run')
  await withNativeSimulatorLease(async (port) => {
    await expect(withNativeSimulatorLease(operation, port)).rejects.toThrow('Native simulator QA port')
    expect(operation).not.toHaveBeenCalled()
    await expect(withNativeSimulatorLease(operation, port)).rejects.toThrow('Native simulator QA port')
  }, 0)
})

it('releases the port without hiding an operation failure', async () => {
  const failure = new Error('proof failed')
  let port = 0
  await expect(withNativeSimulatorLease(async (boundPort) => {
    port = boundPort
    throw failure
  }, 0)).rejects.toBe(failure)
  expect(await withNativeSimulatorLease(async () => 'retry', port)).toBe('retry')
})

it('closes incoming connections without serving data', async () => {
  await withNativeSimulatorLease(async (port) => {
    const received = vi.fn()
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1')
      socket.on('data', received)
      socket.once('error', reject)
      socket.once('close', () => resolve())
    })
    expect(received).not.toHaveBeenCalled()
  }, 0)
})
