import type { MobileTone } from '../../workspace/mobileWorkspaceModel'
import { mobilePalettes, type MobileColors } from '../../ui/theme/mobilePalette'

export { chipTone, statusTone, tagTone, type MobileTagTone } from '../../workspace/mobileNoteDisplay'

export function noteTypeColor(tone: MobileTone, mobileColors: MobileColors = mobilePalettes.light) {
  if (tone === 'blue') return mobileColors.blue
  if (tone === 'green') return mobileColors.green
  if (tone === 'orange') return mobileColors.orange
  if (tone === 'purple') return mobileColors.purple
  if (tone === 'red') return mobileColors.red
  if (tone === 'yellow') return mobileColors.yellow

  return mobileColors.textMuted
}

export function noteTypeSoftColor(tone: MobileTone, mobileColors: MobileColors = mobilePalettes.light) {
  if (tone === 'blue') return mobileColors.blueSoft
  if (tone === 'green') return mobileColors.greenSoft
  if (tone === 'orange') return mobileColors.orangeSoft
  if (tone === 'purple') return mobileColors.purpleSoft
  if (tone === 'red') return mobileColors.redSoft
  if (tone === 'yellow') return mobileColors.yellowSoft

  return mobileColors.graySoft
}
