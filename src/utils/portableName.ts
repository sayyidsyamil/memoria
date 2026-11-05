/**
 * Whether a file or folder name works on every desktop the vault may be cloned to, the
 * desktop's `src-tauri/src/vault/filename_rules.rs`: no Windows-reserved character, no
 * control character, no trailing dot, no `.`/`..`, and not a Windows device name such as
 * `CON` or `LPT1` (with or without an extension).
 */

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

const UNPORTABLE_CHARACTER = /[<>:"/\\|?*\p{Cc}]/u

function isWindowsDeviceName(name: string): boolean {
  const [stem] = name.split('.')
  return WINDOWS_RESERVED_DEVICE_NAMES.has(stem.toUpperCase())
}

export function isPortableName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return false
  if (trimmed.endsWith('.')) return false
  return !UNPORTABLE_CHARACTER.test(trimmed) && !isWindowsDeviceName(trimmed)
}
