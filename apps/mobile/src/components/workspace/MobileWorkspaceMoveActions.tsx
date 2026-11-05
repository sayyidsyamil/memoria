import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { mobileText } from '../../i18n/mobileText'

import { MobileButton } from '../../ui/MobileButton'
import { mobileWorkspaceActionGroupLayoutContract } from './MobileWorkspaceActionSheetModel'

type MoveActionsProps = {
  canMoveDown: boolean
  canMoveUp: boolean
  onMoveDown: () => void
  onMoveUp: () => void
}

type SavedViewActionsProps = MoveActionsProps & {
  onDelete: () => void
}

type TypeSectionActionsProps = MoveActionsProps & {
  canDelete: boolean
  onDelete: () => void
}

type MoveActionLabels = {
  downLabel: string
  downTestID: string
  upLabel: string
  upTestID: string
}

const typeSectionMoveLabels = {
  downLabel: mobileText('sidebar.action.moveSectionDown'),
  downTestID: 'workspace-move-type-down-action',
  upLabel: mobileText('sidebar.action.moveSectionUp'),
  upTestID: 'workspace-move-type-up-action',
}

const savedViewMoveLabels = {
  downLabel: mobileText('sidebar.action.moveViewDown'),
  downTestID: 'workspace-move-view-down-action',
  upLabel: mobileText('sidebar.action.moveViewUp'),
  upTestID: 'workspace-move-view-up-action',
}

const favoriteMoveLabels = {
  downLabel: mobileText('sidebar.action.moveFavoriteDown'),
  downTestID: 'workspace-move-favorite-down-action',
  upLabel: mobileText('sidebar.action.moveFavoriteUp'),
  upTestID: 'workspace-move-favorite-up-action',
}

export const MobileTypeSectionActions = moveActionComponent<TypeSectionActionsProps>(
  typeSectionMoveLabels,
  ({ canDelete, onDelete }) => canDelete ? <DeleteTypeButton onPress={onDelete} /> : null,
)

export const MobileFavoriteActions = moveActionComponent<MoveActionsProps>(
  favoriteMoveLabels,
  () => null,
)

export const MobileSavedViewActions = moveActionComponent<SavedViewActionsProps>(
  savedViewMoveLabels,
  ({ onDelete }) => <DeleteViewButton onPress={onDelete} />,
)

function moveActionComponent<Props extends MoveActionsProps>(
  labels: MoveActionLabels,
  trailingAction: (props: Props) => ReactNode,
) {
  return function ConfiguredMoveActions(props: Props) {
    return <SectionActions {...props} {...labels} trailingAction={trailingAction(props)} />
  }
}

function SectionActions({
  canMoveDown,
  canMoveUp,
  downLabel,
  downTestID,
  onMoveDown,
  onMoveUp,
  trailingAction,
  upLabel,
  upTestID,
}: MoveActionsProps & {
  downLabel: string
  downTestID: string
  trailingAction?: ReactNode
  upLabel: string
  upTestID: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.actions}>
      <ActionButton disabled={!canMoveUp} label={upLabel} testID={upTestID} onPress={onMoveUp} />
      <ActionButton disabled={!canMoveDown} label={downLabel} testID={downTestID} onPress={onMoveDown} />
      {trailingAction}
    </View>
  )
}

function ActionButton({
  danger = false,
  disabled,
  label,
  onPress,
  testID,
}: {
  danger?: boolean
  disabled?: boolean
  label: string
  onPress: () => void
  testID: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <MobileButton
      accessibilityLabel={label}
      disabled={disabled}
      label={label}
      style={[styles.actionButton, danger ? styles.deleteButton : null]}
      testID={testID}
      tone={danger ? 'danger' : 'default'}
      variant="secondary"
      onPress={onPress}
    />
  )
}

function DeleteViewButton({ onPress }: { onPress: () => void }) {
  return (
    <ActionButton danger
      label={mobileText('sidebar.action.deleteView')}
      testID="workspace-delete-view-action"
      onPress={onPress}
    />
  )
}

function DeleteTypeButton({ onPress }: { onPress: () => void }) {
  return (
    <ActionButton danger
      label={mobileText('sidebar.action.deleteType')}
      testID="workspace-delete-type-action"
      onPress={onPress}
    />
  )
}

function createThemeStyles(mobileColors: MobileColors) {
  const styles = StyleSheet.create({
    actions: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: mobileWorkspaceActionGroupLayoutContract.gap,
    },
    actionButton: {
      borderRadius: mobileWorkspaceActionGroupLayoutContract.radius,
      minHeight: mobileWorkspaceActionGroupLayoutContract.minHeight,
      paddingHorizontal: mobileWorkspaceActionGroupLayoutContract.paddingHorizontal,
      paddingVertical: mobileWorkspaceActionGroupLayoutContract.paddingVertical,
    },
    deleteButton: {
      backgroundColor: mobileColors.dangerSoft,
    },
  })
  return { mobileColors, styles }
}
