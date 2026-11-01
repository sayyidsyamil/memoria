import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-clipboard', () => ({
  getStringAsync: vi.fn(),
  setStringAsync: vi.fn(),
}))

import {
  MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY,
  MOBILE_CLIPBOARD_READS_GLOBAL_KEY,
  MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY,
  readMobileClipboardText,
  type MobileClipboardReader,
  type MobileClipboardWriter,
  writeMobileClipboardText,
} from './mobileClipboard'

describe('writeMobileClipboardText', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, MOBILE_CLIPBOARD_READS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY)
  })

  it('reads through the native clipboard adapter and records deterministic QA evidence', async () => {
    const reader: MobileClipboardReader = vi.fn().mockResolvedValue('Plain text only')

    await expect(readMobileClipboardText(reader)).resolves.toBe('Plain text only')

    expect(reader).toHaveBeenCalled()
    expect(globalValue(MOBILE_CLIPBOARD_READS_GLOBAL_KEY)).toEqual(['Plain text only'])
  })

  it('writes through the native clipboard adapter and records deterministic QA evidence', async () => {
    const writer: MobileClipboardWriter = vi.fn().mockResolvedValue(true)

    await writeMobileClipboardText('memoria://laputa/Inbox.md', writer)

    expect(writer).toHaveBeenCalledWith('memoria://laputa/Inbox.md')
    expect(globalValue(MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY)).toEqual(['memoria://laputa/Inbox.md'])
    expect(globalValue(MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY)).toEqual(['memoria://laputa/Inbox.md'])
  })

  it('keeps failed writes out of the completed write log', async () => {
    const writer: MobileClipboardWriter = vi.fn().mockResolvedValue(false)

    await expect(writeMobileClipboardText('memoria://laputa/Inbox.md', writer)).rejects.toThrow('Clipboard write was rejected')

    expect(globalValue(MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY)).toEqual(['memoria://laputa/Inbox.md'])
    expect(globalValue(MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY)).toBeUndefined()
  })
})

function globalValue(key: string): unknown {
  return (globalThis as Record<string, unknown>)[key]
}
