import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richEditorFileUrlResolver } from './richEditorFileUrl'

const resolveRemoteAttachmentUrl = vi.hoisted(() => vi.fn(async (url: string) => `blob:${url}`))
vi.mock('../lib/remoteAttachments', () => ({ resolveRemoteAttachmentUrl }))

const target = window as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

beforeEach(() => {
  target.MEMORIA_REMOTE_URL = 'https://vault.example'
  target.MEMORIA_REMOTE_TOKEN = 'token-for-tests'
})

afterEach(() => {
  delete target.MEMORIA_REMOTE_URL
  delete target.MEMORIA_REMOTE_TOKEN
  resolveRemoteAttachmentUrl.mockClear()
})

describe('the rich editor file URL resolver', () => {
  it('is absent without a remote, so desktop URLs are shown directly', () => {
    delete target.MEMORIA_REMOTE_URL
    expect(richEditorFileUrlResolver()).toBeUndefined()
  })

  it('loads vault attachments through the remote', async () => {
    const resolve = richEditorFileUrlResolver()
    await expect(resolve?.('attachments/a.png')).resolves.toBe('blob:attachments/a.png')
    expect(resolveRemoteAttachmentUrl).toHaveBeenCalledWith('attachments/a.png')
  })

  it('shows other URLs without loading the attachment code', async () => {
    const resolve = richEditorFileUrlResolver()
    await expect(resolve?.('https://example.com/a.png')).resolves.toBe('https://example.com/a.png')
    await expect(resolve?.('attachments/../secret.md')).resolves.toBe('attachments/../secret.md')
    expect(resolveRemoteAttachmentUrl).not.toHaveBeenCalled()
  })
})
