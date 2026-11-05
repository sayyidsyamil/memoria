import { Buffer } from 'buffer'
import { expect, it, vi } from 'vitest'
import { createExpoGitFileSystem } from './expoGitFileSystem'

function fixture(content: Uint8Array<ArrayBuffer>) {
  const write = vi.fn()
  const module = {
    File: class {
      bytes = async () => content
      write = write
      delete = vi.fn()
      info = () => ({ exists: true })
    },
    Directory: class {
      create = vi.fn()
      delete = vi.fn()
    },
    Paths: { info: (uri: string) => ({ exists: true, isDirectory: !uri.endsWith('.pack') }) },
  }
  const adapter = createExpoGitFileSystem('file:///fixture', module, async () => [], module.Paths.info).promises
  return { adapter, write }
}

it('reads a bounded native byte view without duplicating a pack buffer', async () => {
  const content = new Uint8Array([90, 0, 255, 128, 91]).subarray(1, 4)
  const { adapter } = fixture(content)
  const result = await adapter.readFile('/vault/objects.pack')
  expect(result).toBeInstanceOf(Buffer)
  if (typeof result === 'string') throw new Error('Expected binary Git bytes')
  expect(Object.is(result.buffer, content.buffer)).toBe(true)
  expect(result.byteOffset).toBe(content.byteOffset)
  expect([...result]).toEqual([0, 255, 128])
})

it('writes a plain bounded Uint8Array without duplicating a Buffer', async () => {
  const content = Buffer.from([90, 0, 255, 128, 91]).subarray(1, 4)
  const { adapter, write } = fixture(content)
  await adapter.writeFile('/vault/objects.pack', content)
  const result = write.mock.calls[0][0]
  expect(result.constructor).toBe(Uint8Array)
  expect(Object.is(result.buffer, content.buffer)).toBe(true)
  expect(result.byteOffset).toBe(content.byteOffset)
  expect([...result]).toEqual([0, 255, 128])
})

it('decodes only the requested view and preserves direct string writes', async () => {
  const content = Buffer.from('prefix:hello:suffix').subarray(7, 12)
  const { adapter, write } = fixture(content)
  expect(await adapter.readFile('/vault/objects.pack', 'utf8')).toBe('hello')
  expect(await adapter.readFile('/vault/objects.pack', { encoding: 'utf8' })).toBe('hello')
  await adapter.writeFile('/vault/objects.pack', 'updated')
  expect(write).toHaveBeenCalledWith('updated')
})
