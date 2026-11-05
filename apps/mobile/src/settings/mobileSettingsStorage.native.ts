import { File, Paths } from 'expo-file-system'
import { parseMobileSettings, type MobileSettings } from './mobileSettings'

function settingsFile(suffix = '') { return new File(Paths.document, '.memoria-mobile-config', `settings.json${suffix}`) }

export async function readMobileSettings(): Promise<MobileSettings> {
  const current = settingsFile()
  const backup = settingsFile('.backup')
  try {
    if (current.exists) return parseMobileSettings(await current.text())
    if (backup.exists) return parseMobileSettings(await backup.text())
    return parseMobileSettings(null)
  } catch (error) {
    if (backup.exists) return parseMobileSettings(await backup.text())
    throw error
  }
}

export async function writeMobileSettings(settings: MobileSettings) {
  const content = JSON.stringify(settings)
  parseMobileSettings(content)
  const current = settingsFile()
  const pending = settingsFile('.pending')
  pending.parentDirectory.create({ intermediates: true, idempotent: true })
  pending.write(content)
  parseMobileSettings(await pending.text())
  if (current.exists) await preserveCurrentSettings(current)
  pending.move(settingsFile())
}

async function preserveCurrentSettings(current: File) {
  const backup = settingsFile('.backup')
  let valid = false
  try { parseMobileSettings(await current.text()); valid = true } catch { /* Preserve a valid recovery copy. */ }
  if (!valid) {
    parseMobileSettings(await backup.text())
    current.delete()
    return
  }
  if (backup.exists) backup.delete()
  current.move(backup)
}
