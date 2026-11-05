import { useContext, type ContextType } from 'react'
import { View } from 'react-native'
import { mobileText } from '../../i18n/mobileText'
import { useMobileColors } from '../../ui/theme/useMobileTheme'
import { MobileVaultControlsContext, MobileVaultDisplayContext } from '../../workspace/MobileVaultContext'
import { pendingNotePath } from '../../workspace/mobilePendingChanges'

const noPendingPaths: ReadonlySet<string> = new Set()

export function MobilePendingNoteIndicator({ note }: { note: { id: string; path?: string } }) {
  const controls = useContext(MobileVaultControlsContext)
  const display = useContext(MobileVaultDisplayContext)
  const colors = useMobileColors()
  const paths = pendingPathsForVault(controls, display)
  if (!pendingNotePath(paths, note.path ?? note.id)) return null
  return <View accessible accessibilityLabel={mobileText('mobile.sync.pendingShort')}
    pointerEvents="none" testID={`note-pending-${note.id}`}
    style={{ backgroundColor: colors.yellow, borderRadius: 4, flexShrink: 0, height: 8, width: 8 }} />
}

function pendingPathsForVault(controls: ContextType<typeof MobileVaultControlsContext>, display: ContextType<typeof MobileVaultDisplayContext>) {
  if (!controls) return noPendingPaths
  if (![controls.git, controls.linked].some(Boolean)) return noPendingPaths
  if (display?.source !== 'native' || display.rootUri !== controls.rootUri) return noPendingPaths
  return controls.pendingNotePaths ?? noPendingPaths
}
