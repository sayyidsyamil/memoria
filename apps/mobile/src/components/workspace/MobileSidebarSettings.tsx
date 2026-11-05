import { ArrowClockwise, Command, GearSix } from 'phosphor-react-native'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useContext, useEffect, useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { mobileText } from '../../i18n/mobileText'
import { useMobileSettings } from '../../settings/useMobileSettings'
import { useMobileColors } from '../../ui/theme/useMobileTheme'
import { Button } from '../ui/button'
import { Text } from '../ui/text'
import { MobileVaultControlsContext, MobileVaultDisplayContext } from '../../workspace/MobileVaultContext'
import { sidebarSyncPresentation } from './mobileSidebarSyncStatus'
import { mobilePaneFooterFrame } from './mobilePaneFooterLayout'

export function MobileSidebarSettings({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const preferences = useMobileSettings()
  const colors = useMobileColors()
  const insets = useSafeAreaInsets()
  const buttonStyle = [styles.button, { backgroundColor: colors.control }]
  return <View pointerEvents="box-none" style={[styles.footer, mobilePaneFooterFrame(insets.bottom)]} testID="sidebar-settings">
    <SidebarSyncPill autoGit={preferences.settings.autoGit} />
    {onOpenCommandPalette && <Button accessibilityLabel={mobileText('menu.view.commandPalette')} size="icon" variant="secondary" style={buttonStyle}
      className="h-12 w-12 rounded-[24px] sm:h-12 sm:w-12"
      onPress={onOpenCommandPalette} testID="sidebar-command-palette-action">
      <Command size={22} color={colors.textMuted} />
    </Button>}
    <Button accessibilityLabel={mobileText('settings.title')} size="icon" variant="secondary" style={buttonStyle}
      className="h-12 w-12 rounded-[24px] sm:h-12 sm:w-12"
      onPress={preferences.open} testID="open-mobile-settings">
      <GearSix size={22} color={colors.textMuted} />
    </Button>
  </View>
}

function SidebarSyncPill({ autoGit }: { autoGit: boolean }) {
  const controls = useContext(MobileVaultControlsContext)
  const display = useContext(MobileVaultDisplayContext)
  const colors = useMobileColors()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const state = sidebarSyncPresentation(controls, display, autoGit, now)
  if (!state || !controls) return null
  const action = mobileText(state.action === 'sync' ? 'status.sync.now' : 'status.vault.manageWorkspaces')
  const color = state.problem ? colors.danger : colors.textMuted
  const label = [state.destination, state.state, state.lastSync, action].filter(Boolean).join('. ')
  return <Button variant="secondary" accessibilityLabel={label} accessibilityHint={action} disabled={state.disabled}
    accessibilityState={{ busy: state.busy, disabled: state.disabled }}
    className="h-auto min-h-12 flex-1 rounded-[24px] px-3 py-2 sm:h-auto"
    style={[styles.sync, { backgroundColor: colors.control }]} testID="sidebar-sync-action"
    onPress={() => { void (state.action === 'sync' ? controls.sync() : controls.open()) }}>
    {state.busy ? <ActivityIndicator size="small" color={color} /> : <ArrowClockwise size={18} color={color} />}
    <View style={styles.syncText}>
      <View style={styles.destinationRow}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.destination, { color: colors.text }]} testID="sidebar-sync-destination">{state.destination}</Text>
        {state.pendingLocalChanges && <View accessible={false} style={[styles.pendingDot, { backgroundColor: colors.yellow }]} testID="sidebar-sync-pending-local" />}
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.detail, { color }]} testID="sidebar-sync-state">{state.detail}</Text>
    </View>
  </Button>
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 8 },
  button: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sync: { flex: 1, minWidth: 0, minHeight: 48, height: 48, paddingHorizontal: 8, paddingVertical: 0,
    borderRadius: 24, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'flex-start' },
  syncText: { flex: 1, minWidth: 0 },
  destinationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  destination: { fontSize: 13, lineHeight: 17, fontWeight: '500', flexShrink: 1, minWidth: 0 },
  pendingDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  detail: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
})
