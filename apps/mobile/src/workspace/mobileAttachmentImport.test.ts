import { afterEach, describe, expect, it } from 'vitest'
import {
  importMobileAttachment,
  MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY,
  readMobileAttachmentImportFromGlobal,
} from './mobileAttachmentImport'

describe('mobile attachment import web fallback', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY)
  })

  it('reads one deterministic imported attachment from the QA global', () => {
    Reflect.set(globalThis, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY, {
      mimeType: 'application/pdf',
      name: 'Project Brief.pdf',
      path: 'attachments/project brief.pdf',
    })

    expect(readMobileAttachmentImportFromGlobal()).toEqual({
      mimeType: 'application/pdf',
      name: 'Project Brief.pdf',
      path: 'attachments/project brief.pdf',
    })
    expect(readMobileAttachmentImportFromGlobal()).toBeNull()
  })

  it('consumes queued deterministic imported attachments in order', () => {
    Reflect.set(globalThis, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY, [
      { name: 'First.png', path: 'attachments/first.png' },
      { mimeType: null, name: 'Second.pdf', path: 'attachments/second.pdf' },
    ])

    expect(readMobileAttachmentImportFromGlobal()).toEqual({
      name: 'First.png',
      path: 'attachments/first.png',
    })
    expect(readMobileAttachmentImportFromGlobal()).toEqual({
      mimeType: null,
      name: 'Second.pdf',
      path: 'attachments/second.pdf',
    })
    expect(readMobileAttachmentImportFromGlobal()).toBeNull()
  })

  it('ignores malformed deterministic imports', () => {
    Reflect.set(globalThis, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY, { name: 'Missing path' })

    expect(readMobileAttachmentImportFromGlobal()).toBeNull()
  })
})

describe('mobile native attachment import', () => {
  it('copies picked files into the selected vault attachments folder', async () => {
    const fileSystem = fakeAttachmentFileSystem(['42-Project_Brief.pdf'])
    const result = await importMobileAttachment({
      fileSystem,
      nowMs: () => 42,
      pickDocument: async () => ({
        assets: [{
          mimeType: 'application/pdf',
          name: 'Project Brief.pdf',
          uri: 'file:///cache/picked.pdf',
        }],
        canceled: false,
      }),
      vaultRootUri: 'file:///vault',
    })

    expect(result).toEqual({
      mimeType: 'application/pdf',
      name: 'Project Brief.pdf',
      path: 'attachments/42-2-Project_Brief.pdf',
    })
    expect(fileSystem.createdDirectories).toEqual([
      { options: { intermediates: true }, uri: 'file:///vault/attachments/' },
    ])
    expect(fileSystem.copies).toEqual([{
      from: 'file:///cache/picked.pdf',
      to: 'file:///vault/attachments/42-2-Project_Brief.pdf',
    }])
  })

  it('treats cancelled or rootless native imports as no attachment', async () => {
    const fileSystem = fakeAttachmentFileSystem()

    await expect(importMobileAttachment({
      fileSystem,
      pickDocument: async () => ({ assets: null, canceled: true }),
      vaultRootUri: 'file:///vault',
    })).resolves.toBeNull()
    await expect(importMobileAttachment({
      fileSystem,
      pickDocument: async () => ({
        assets: [{ name: 'Project.pdf', uri: 'file:///cache/project.pdf' }],
        canceled: false,
      }),
      vaultRootUri: '',
    })).resolves.toBeNull()
    expect(fileSystem.copies).toEqual([])
  })

  it('returns null instead of crashing when native copy fails', async () => {
    const fileSystem = fakeAttachmentFileSystem()
    fileSystem.copyAsync = async () => {
      throw new Error('copy failed')
    }

    await expect(importMobileAttachment({
      fileSystem,
      pickDocument: async () => ({
        assets: [{ name: 'Project.pdf', uri: 'file:///cache/project.pdf' }],
        canceled: false,
      }),
      vaultRootUri: 'file:///vault',
    })).resolves.toBeNull()
  })
})

function fakeAttachmentFileSystem(existingNames: string[] = []) {
  const copies: Array<{ from: string; to: string }> = []
  const createdDirectories: Array<{ options?: { intermediates?: boolean }; uri: string }> = []

  return {
    copies,
    createdDirectories,
    async copyAsync(options: { from: string; to: string }) {
      copies.push(options)
    },
    async makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }) {
      createdDirectories.push({ options, uri })
    },
    async readDirectoryAsync() {
      return existingNames
    },
  }
}
