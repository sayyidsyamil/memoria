import * as Clipboard from 'expo-clipboard'

export const MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY = '__MEMORIA_MOBILE_CLIPBOARD_ATTEMPTS__'
export const MOBILE_CLIPBOARD_READS_GLOBAL_KEY = '__MEMORIA_MOBILE_CLIPBOARD_READS__'
export const MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY = '__MEMORIA_MOBILE_CLIPBOARD_WRITES__'

type MobileClipboardText = string

export type MobileClipboardReader = () => Promise<MobileClipboardText>
export type MobileClipboardWriteResult = boolean | undefined
export type MobileClipboardWriter = (text: MobileClipboardText) => Promise<MobileClipboardWriteResult>

export async function readMobileClipboardText(
  reader: MobileClipboardReader = Clipboard.getStringAsync,
): Promise<MobileClipboardText> {
  const text = await reader()
  recordGlobalClipboardValue(MOBILE_CLIPBOARD_READS_GLOBAL_KEY, text)
  return text
}

export async function writeMobileClipboardText(
  text: MobileClipboardText,
  writer: MobileClipboardWriter = Clipboard.setStringAsync,
): Promise<void> {
  recordGlobalClipboardValue(MOBILE_CLIPBOARD_ATTEMPTS_GLOBAL_KEY, text)
  const result = await writer(text)
  if (result === false) throw new Error('Clipboard write was rejected')
  recordGlobalClipboardValue(MOBILE_CLIPBOARD_WRITES_GLOBAL_KEY, text)
}

function recordGlobalClipboardValue(key: string, text: MobileClipboardText) {
  const target = globalThis as Record<string, unknown>
  const current = target[key]
  const values = Array.isArray(current) ? current : []
  values.push(text)
  target[key] = values
}
