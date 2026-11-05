import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { CheckCircle, Plus, WarningCircle, X } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'
import { MobileTextInput } from '../../ui/MobileTextInput'
import type { MobileNote, MobileViewFilterCondition, MobileViewFilterGroup, MobileViewFilterNode, MobileViewFilterOp, MobileTypeDefinitions } from '../../workspace/mobileWorkspaceModel'
import { mobileViewFieldSuggestions, mobileViewValueSuggestionItems } from '../../workspace/mobileWorkspaceSuggestions'
import { MobileWorkspaceSuggestionList } from './MobileWorkspaceSuggestionList'
import { mobileViewFilterConditionWithOperator, mobileViewFilterDatePreviewLabel, mobileViewFilterRegexIsInvalid, mobileViewFilterRegexSupported, mobileViewFilterValueFromText, mobileViewFilterValueInputKind, mobileViewFilterValueText, mobileViewFilterValueWithSuggestion } from './MobileViewFilterValueModel'
import { mobileWorkspaceFormSheetMaxSuggestions } from './MobileWorkspaceActionSheetModel'
import { createViewFilterStyles as createThemeStyles } from './mobileViewFilterStyles'

type FilterPath = string

type FilterMode = 'all' | 'any'

type FilterChange = (group: MobileViewFilterGroup) => void

type ConditionChange = (condition: MobileViewFilterCondition) => void

const emptyPath = 'root'

const defaultField = 'type'

const noValueOps = new Set<MobileViewFilterOp>(['is_empty', 'is_not_empty'])

const operators: MobileViewFilterOp[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'any_of',
  'none_of',
  'is_empty',
  'is_not_empty',
  'before',
  'after',
]

export function MobileViewFilterBuilder({
  group,
  notes,
  onChange,
  typeDefinitions,
}: {
  group: MobileViewFilterGroup
  notes: MobileNote[]
  onChange: FilterChange
  typeDefinitions?: MobileTypeDefinitions
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.builder} testID="workspace-view-filter-builder">
      <Text style={styles.label}>{mobileText('viewDialog.filtersLabel')}</Text>
      <FilterGroupEditor
        group={group}
        notes={notes}
        path=""
        typeDefinitions={typeDefinitions}
        onChange={onChange}
      />
    </View>
  )
}

function FilterGroupEditor({
  group,
  notes,
  onChange,
  onRemove,
  path,
  typeDefinitions,
}: {
  group: MobileViewFilterGroup
  notes: MobileNote[]
  onChange: FilterChange
  onRemove?: () => void
  path: FilterPath
  typeDefinitions?: MobileTypeDefinitions
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const mode = groupMode(group)
  const nodes = groupNodes(group)

  return (
    <View style={[styles.group, path ? styles.nestedGroup : null]} testID={`workspace-view-filter-group-${testPath(path)}`}>
      <GroupHeader mode={mode} onRemove={onRemove} onToggleMode={() => onChange(groupWithNodes(nextMode(mode), nodes))} />
      <View style={styles.nodeList}>
        {nodes.map((node, index) => (
          <FilterNodeEditor
            key={`${testPath(path)}-${index}`}
            node={node}
            notes={notes}
            path={childPath(path, index)}
            typeDefinitions={typeDefinitions}
            onChange={(nextNode) => onChange(updateNode(group, index, nextNode))}
            onRemove={() => onChange(removeNode(group, index))}
          />
        ))}
      </View>
      <GroupActions
        onAddCondition={() => onChange(addNode(group, defaultCondition(notes, typeDefinitions)))}
        onAddGroup={() => onChange(addNode(group, { all: [defaultCondition(notes, typeDefinitions)] }))}
      />
    </View>
  )
}

function GroupHeader({
  mode,
  onRemove,
  onToggleMode,
}: {
  mode: FilterMode
  onRemove?: () => void
  onToggleMode: () => void
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.groupHeader}>
      <MobileButton
        density="compact"
        label={mobileText(mode === 'all' ? 'viewDialog.filter.and' : 'viewDialog.filter.or')}
        style={styles.modeButton}
        testID="workspace-view-filter-mode-toggle"
        variant="secondary"
        onPress={onToggleMode}
      />
      <Text style={styles.groupHint}>{mobileText(mode === 'all' ? 'viewDialog.filter.matchAll' : 'viewDialog.filter.matchAny')}</Text>
      {onRemove ? (
        <IconPressable accessibilityLabel={mobileText('common.remove')} testID="workspace-view-filter-remove-group" onPress={onRemove}>
          <X color={mobileColors.textMuted} size={14} />
        </IconPressable>
      ) : null}
    </View>
  )
}

function FilterNodeEditor({
  node,
  notes,
  onChange,
  onRemove,
  path,
  typeDefinitions,
}: {
  node: MobileViewFilterNode
  notes: MobileNote[]
  onChange: (node: MobileViewFilterNode) => void
  onRemove: () => void
  path: FilterPath
  typeDefinitions?: MobileTypeDefinitions
}) {
  if (isFilterGroup(node)) {
    return <FilterGroupEditor group={node} notes={notes} path={path} typeDefinitions={typeDefinitions} onChange={onChange} onRemove={onRemove} />
  }

  return (
    <FilterConditionEditor
      condition={node}
      notes={notes}
      path={path}
      typeDefinitions={typeDefinitions}
      onChange={onChange}
      onRemove={onRemove}
    />
  )
}

function FilterConditionEditor({
  condition,
  notes,
  onChange,
  onRemove,
  path,
  typeDefinitions,
}: {
  condition: MobileViewFilterCondition
  notes: MobileNote[]
  onChange: ConditionChange
  onRemove: () => void
  path: FilterPath
  typeDefinitions?: MobileTypeDefinitions
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  const pathId = testPath(path)
  const fieldSuggestions = mobileViewFieldSuggestions(notes, condition.field, typeDefinitions)
  const valueText = mobileViewFilterValueText(condition)
  const valueSuggestions = mobileViewValueSuggestionItems(notes, condition.field, valueText, typeDefinitions)
  const valueInputKind = mobileViewFilterValueInputKind(condition.op)
  const invalidRegex = mobileViewFilterRegexIsInvalid(condition)
  const datePreviewLabel = valueInputKind === 'date' ? mobileViewFilterDatePreviewLabel(valueText) : null

  return (
    <View style={styles.condition} testID={`workspace-view-filter-row-${pathId}`}>
      <View style={styles.conditionHeader}>
        <Text style={styles.conditionTitle}>{condition.field || defaultField}</Text>
        <IconPressable accessibilityLabel={mobileText('common.remove')} testID={`workspace-view-filter-remove-${pathId}`} onPress={onRemove}>
          <X color={mobileColors.textMuted} size={14} />
        </IconPressable>
      </View>
      <MobileTextInput
        label={mobileText('viewDialog.filter.fieldLabel')}
        testID={`workspace-view-filter-field-input-${pathId}`}
        value={condition.field}
        onChangeText={(field) => onChange({ ...condition, field })}
      />
      <MobileWorkspaceSuggestionList
        labels={fieldSuggestions}
        maxVisibleItems={mobileWorkspaceFormSheetMaxSuggestions}
        testID={`workspace-view-filter-field-suggestions-${pathId}`}
        testIDPrefix={`workspace-view-filter-field-suggestion-${pathId}`}
        onSelect={(field) => onChange({ ...condition, field })}
      />
      <OperatorPicker condition={condition} pathId={pathId} onChange={onChange} />
      {noValueOps.has(condition.op) ? null : (
        <>
          <MobileTextInput
            keyboardType={valueInputKind === 'date' ? 'numbers-and-punctuation' : 'default'}
            label={mobileText('viewDialog.filter.valueLabel')}
            placeholder={valueInputKind === 'date' ? 'YYYY-MM-DD' : undefined}
            style={invalidRegex ? styles.invalidInput : null}
            testID={`workspace-view-filter-value-input-${pathId}`}
            value={valueText}
            onChangeText={(value) => onChange({ ...condition, value: mobileViewFilterValueFromText(condition.op, value) })}
          />
          <FilterValueFeedback invalidRegex={invalidRegex} datePreviewLabel={datePreviewLabel} pathId={pathId} />
          <MobileWorkspaceSuggestionList
            items={valueSuggestions}
            maxVisibleItems={mobileWorkspaceFormSheetMaxSuggestions}
            testID={`workspace-view-filter-value-suggestions-${pathId}`}
            testIDPrefix={`workspace-view-filter-value-suggestion-${pathId}`}
            onSelect={(value) => onChange({ ...condition, value: mobileViewFilterValueWithSuggestion(condition, value) })}
          />
        </>
      )}
    </View>
  )
}

function OperatorPicker({
  condition,
  onChange,
  pathId,
}: {
  condition: MobileViewFilterCondition
  onChange: ConditionChange
  pathId: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const regexSupported = mobileViewFilterRegexSupported(condition.op)
  const regexEnabled = regexSupported && condition.regex === true

  return (
    <View style={styles.operatorWrap}>
      {operators.map((operator) => (
        <OperatorPill
          active={condition.op === operator}
          key={operator}
          label={operatorLabel(operator)}
          testID={`workspace-view-filter-operator-${pathId}-${operator}`}
          onPress={() => onChange(mobileViewFilterConditionWithOperator(condition, operator, regexEnabled))}
        />
      ))}
      {regexSupported ? (
        <OperatorPill
          active={regexEnabled}
          label=".*"
          testID={`workspace-view-filter-regex-${pathId}`}
          onPress={() => onChange({ ...condition, regex: regexEnabled ? undefined : true })}
        />
      ) : null}
    </View>
  )
}

function FilterValueFeedback({
  datePreviewLabel,
  invalidRegex,
  pathId,
}: {
  datePreviewLabel: string | null
  invalidRegex: boolean
  pathId: string
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  if (invalidRegex) {
    return (
      <View style={styles.feedbackRow} testID={`workspace-view-filter-regex-invalid-${pathId}`}>
        <WarningCircle color={mobileColors.danger} size={13} />
        <Text style={styles.invalidText}>{mobileText('editor.find.invalidRegex')}</Text>
      </View>
    )
  }

  if (datePreviewLabel) {
    return (
      <Text style={styles.valuePreview} testID={`workspace-view-filter-date-preview-${pathId}`}>
        {datePreviewLabel}
      </Text>
    )
  }

  return null
}

function OperatorPill({
  active,
  label,
  onPress,
  testID,
}: {
  active: boolean
  label: string
  onPress: () => void
  testID: string
}) {
  const { mobileColors, styles } = useMobileStyles(createThemeStyles)
  return (
    <MobileButton
      accessibilityLabel={label}
      accessibilityRole="button"
      density="compact"
      icon={<CheckCircle color={active ? mobileColors.primary : mobileColors.textFaint} size={13} weight={active ? 'fill' : 'regular'} />}
      label={label}
      style={[styles.operatorPill, active ? styles.operatorPillActive : null]}
      testID={testID}
      variant="secondary"
      onPress={onPress}
    />
  )
}

function GroupActions({
  onAddCondition,
  onAddGroup,
}: {
  onAddCondition: () => void
  onAddGroup: () => void
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.actions}>
      <MobileButton density="compact" icon={<Plus color={mobileColors.textMuted} size={12} />} label={mobileText('viewDialog.filter.addFilter')} variant="ghost" onPress={onAddCondition} />
      <MobileButton density="compact" icon={<Plus color={mobileColors.textMuted} size={12} />} label={mobileText('viewDialog.filter.addGroup')} variant="ghost" onPress={onAddGroup} />
    </View>
  )
}

function IconPressable({
  accessibilityLabel,
  children,
  onPress,
  testID,
}: {
  accessibilityLabel: string
  children: ReactNode
  onPress: () => void
  testID: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" style={styles.iconButton} testID={testID} onPress={onPress}>
      {children}
    </Pressable>
  )
}

function defaultCondition(
  notes: MobileNote[],
  typeDefinitions?: MobileTypeDefinitions,
): MobileViewFilterCondition {
  return {
    field: mobileViewFieldSuggestions(notes, '', typeDefinitions)[0] ?? defaultField,
    op: 'equals',
    value: '',
  }
}

function groupMode(group: MobileViewFilterGroup): FilterMode {
  return 'any' in group ? 'any' : 'all'
}

function groupNodes(group: MobileViewFilterGroup): MobileViewFilterNode[] {
  return 'any' in group ? group.any : group.all
}

function groupWithNodes(mode: FilterMode, nodes: MobileViewFilterNode[]): MobileViewFilterGroup {
  return mode === 'any' ? { any: nodes } : { all: nodes }
}

function addNode(group: MobileViewFilterGroup, node: MobileViewFilterNode): MobileViewFilterGroup {
  return groupWithNodes(groupMode(group), [...groupNodes(group), node])
}

function updateNode(group: MobileViewFilterGroup, index: number, node: MobileViewFilterNode): MobileViewFilterGroup {
  return groupWithNodes(groupMode(group), groupNodes(group).map((candidate, candidateIndex) => candidateIndex === index ? node : candidate))
}

function removeNode(group: MobileViewFilterGroup, index: number): MobileViewFilterGroup {
  return groupWithNodes(groupMode(group), groupNodes(group).filter((_node, nodeIndex) => nodeIndex !== index))
}

function nextMode(mode: FilterMode): FilterMode {
  return mode === 'all' ? 'any' : 'all'
}

function isFilterGroup(node: MobileViewFilterNode): node is MobileViewFilterGroup {
  return 'all' in node || 'any' in node
}

function childPath(parent: FilterPath, index: number) {
  return parent ? `${parent}-${index}` : String(index)
}

function testPath(path: FilterPath) {
  return path || emptyPath
}

function operatorLabel(operator: MobileViewFilterOp) {
  return mobileText(`viewDialog.filter.operator.${operator}`)
}
