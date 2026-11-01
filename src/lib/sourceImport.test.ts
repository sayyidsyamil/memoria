import { expect, it, vi } from 'vitest'
import { applySource, attachmentFilename, prepareSource } from './sourceImport'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

it('preserves original bytes before creating a page-linked source without overwriting existing notes', async () => {
  vi.mocked(invoke).mockResolvedValueOnce('/vault/attachments/123-meeting.txt').mockResolvedValueOnce(undefined)
  const path = await applySource({ id: 'unique', filename: 'meeting.txt', title: 'Meeting', sha256: 'abc',
    bytes: new Uint8Array([65]), pages: ['First page', 'Second page'] }, '/vault')
  expect(path).toBe('source-Meeting-unique.md')
  expect(invoke).toHaveBeenNthCalledWith(1, 'save_image', { vaultPath: '/vault', filename: 'meeting.txt', data: 'QQ==' })
  expect(invoke).toHaveBeenNthCalledWith(2, 'create_note_content', expect.objectContaining({
    vaultPath: '/vault', path: '/vault/source-Meeting-unique.md',
    content: expect.stringContaining('[Open original](<attachments/123-meeting.txt>)'),
  }))
  const payload = vi.mocked(invoke).mock.calls[1][1] as { content: string }
  expect(payload.content).toContain('## Page 2\n\nSecond page')
  expect(payload.content).toContain('sha256: abc')
})

it('rejects unsupported and oversized files before processing', async () => {
  await expect(prepareSource({ name: 'file.exe', size: 2 } as File)).rejects.toThrow('Choose a PDF')
  await expect(prepareSource({ name: 'file.pdf', size: 21 * 1024 * 1024 } as File)).rejects.toThrow('20 MB')
})

it('reuses a checkpointed original and accepts only an identical source page on retry', async () => {
  vi.mocked(invoke).mockReset()
  const source = { id: 'retry', filename: 'meeting.txt', title: 'Meeting', sha256: 'abc',
    bytes: new Uint8Array([65]), pages: ['Evidence'], originalPath: '/vault/attachments/original.txt', importedAt: '2026-10-30T00:00:00Z' }
  let written = ''
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'create_note_content') { written = (args as { content: string }).content; throw new Error('Already exists') }
    return written
  })
  expect(await applySource(source, '/vault')).toBe('source-Meeting-retry.md')
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'save_image')).toBe(false)
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Already exists')).mockResolvedValueOnce('Different user content')
  await expect(applySource(source, '/vault')).rejects.toThrow('Already exists')
})

it('keeps stored attachment names within the filesystem limit and preserves the extension', () => {
  expect(attachmentFilename('meeting.txt')).toBe('meeting.txt')
  const long = `ZQ7-${'x'.repeat(240)}.txt`
  const short = attachmentFilename(long)
  expect(short.endsWith('.txt')).toBe(true)
  expect(new TextEncoder().encode(`1793382649074-${short}`).length).toBeLessThanOrEqual(255)
  expect(new TextEncoder().encode(attachmentFilename(`${'会议记录'.repeat(60)}.vtt`)).length).toBeLessThanOrEqual(155)
})

it('stores a shortened attachment name when the original filename is too long', async () => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValueOnce('/vault/attachments/1-short.txt').mockResolvedValueOnce(undefined)
  await applySource({ id: 'long', filename: `${'y'.repeat(250)}.txt`, title: 'Long', sha256: 'abc', bytes: new Uint8Array([65]), pages: ['x'] }, '/vault')
  const saved = vi.mocked(invoke).mock.calls[0][1] as { filename: string }
  expect(saved.filename.length).toBeLessThan(160)
  expect(saved.filename.endsWith('.txt')).toBe(true)
})

const textFile = (name: string, bytes: number[]) => ({ name, size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as File

it('reads UTF-16 text with a byte-order mark and explains non-UTF-8 text', async () => {
  const utf16 = [0xff, 0xfe, ...Array.from('Zoë ok', char => [char.charCodeAt(0), 0]).flat()]
  expect((await prepareSource(textFile('note.txt', utf16))).pages).toEqual(['Zoë ok'])
  await expect(prepareSource(textFile('latin1.txt', [0x63, 0x61, 0x66, 0xe9]))).rejects.toThrow('not valid UTF-8')
})

it('names empty text files instead of blaming OCR', async () => {
  await expect(prepareSource(textFile('empty.txt', []))).rejects.toThrow('This file has no readable text.')
})
