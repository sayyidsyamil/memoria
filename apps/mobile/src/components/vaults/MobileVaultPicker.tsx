import { useContext } from 'react'
import { CaretDown, Check, GearSix } from 'phosphor-react-native'
import { StyleSheet } from 'react-native'
import { MobileVaultPickerContext } from '../../workspace/MobileVaultContext'
import { mobileText } from '../../i18n/mobileText'
import { useMobileColors } from '../../ui/theme/useMobileTheme'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Text } from '../ui/text'

export function MobileVaultPicker() {
  const picker = useContext(MobileVaultPickerContext)
  const colors = useMobileColors()
  if (!picker) return null
  return <DropdownMenu>
    <DropdownMenuTrigger accessibilityLabel={mobileText('status.vault.switch')} disabled={picker.disabled}
      style={styles.trigger} testID="sidebar-vault-picker">
      <CaretDown color={colors.textMuted} size={20} />
    </DropdownMenuTrigger>
    <DropdownMenuContent side="bottom" align="end" testID="sidebar-vault-options">
      {picker.choices.map(choice => <DropdownMenuItem key={choice.id} textValue={choice.label}
        accessibilityLabel={choice.label} accessibilityState={{ selected: choice.selected }} disabled={picker.disabled}
        onPress={() => { void choice.select() }} testID={`quick-select-vault-${choice.id}`}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>{choice.label}</Text>
        {choice.selected && <Check color={colors.primary} size={18} />}
      </DropdownMenuItem>)}
      <DropdownMenuItem textValue={mobileText('status.vault.manageWorkspaces')} disabled={picker.disabled}
        onPress={() => picker.manage()} testID="quick-manage-vaults" style={[styles.manage, { borderTopColor: colors.border }]}>
        <GearSix color={colors.textMuted} size={18} />
        <Text style={[styles.label, { color: colors.text }]}>{mobileText('status.vault.manageWorkspaces')}</Text>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

const styles = StyleSheet.create({
  trigger: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 16 },
  manage: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
})
