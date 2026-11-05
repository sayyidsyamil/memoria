import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import { useRef } from 'react'
import { Platform, Pressable, ScrollView, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { FilePlus } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'
import { MobileChip } from '../../ui/MobileChip'
import { MobileToolbar, MobileToolbarSpacer, MobileToolbarTitle } from '../../ui/MobilePanel'
import { MobileTextInput } from '../../ui/MobileTextInput'
import { useMobileDeviceLayout } from '../../ui/useMobileDeviceLayout'
import { canSubmitMobilePropertyValue, isMobileListPropertyKey, mobilePropertyValueKindForKey } from '../../workspace/mobilePropertyValues'
import { mobileWikilinkTargetForNote } from '../../workspace/mobileWikilinks'
import { mobilePropertyKeySuggestions, mobilePropertyValueSuggestions, mobileRelationshipKeySuggestions, mobileRelationshipTargetSuggestions, shouldShowMobileRelationshipCreateTarget } from '../../workspace/mobileWorkspaceSuggestions'
import { MobileTypeIcon } from './MobileWorkspaceIcons'
import { MobilePropertyValueEditor } from './MobilePropertyValueEditor'
import { MobileWorkspaceSuggestionList } from './MobileWorkspaceSuggestionList'
import { chipTone } from './mobileWorkspaceTone'
import { createMobileWorkspaceSheetStyles as createThemeStyles } from './mobileWorkspaceActionSheetStyles'
import { mobileFormScrollOffset, mobilePropertyDeleteActionVisible, mobileWorkspacePropertyActionTestIds, mobileWorkspaceRelationshipActionTestIds, mobileWorkspaceRelationshipTargetMaxSuggestions, mobileWorkspaceFormSheetAutoFocus, mobileWorkspaceFormSheetMaxSuggestions } from './MobileWorkspaceActionSheetModel'
import type { ActionContentProps, WorkspaceFormProps } from './MobileWorkspaceActionSheet.types'
import { phoneSheetStyles, actionTitle } from './mobileWorkspaceSheetPresentation'
import { SheetFooter } from './MobileWorkspaceSheetChrome'

export function AddPropertyContent(props: ActionContentProps) {
  const { styles } = useMobileStyles(createThemeStyles)
  const { compactForm } = props
  const focusedScroll = useFocusedFormScroll()
  return (
    <View style={[styles.formBody, compactForm && phoneSheetStyles.compactBody]}>
      <PropertyFormHeader form={props} />
      <ScrollView {...focusedScroll} contentContainerStyle={[styles.content, compactForm && phoneSheetStyles.compactContent]} keyboardShouldPersistTaps="handled" style={styles.scrollArea} testID="workspace-property-form-scroll">
        <PropertyFormFields form={props} />
        {compactForm ? <PropertyDeleteAction form={props} /> : null}
      </ScrollView>
      <PropertyFormFooter form={props} />
    </View>
  )
}

function PropertyFormHeader({ form: props }: WorkspaceFormProps) {
  if (!props.compactForm) return null
  return (<MobileToolbar testID="workspace-action-sheet-toolbar">
    <MobileToolbarTitle title={actionTitle(props.action, props.propertyName)} />
    <MobileToolbarSpacer />
    <PropertyFormActions form={props} />
  </MobileToolbar>)
}

function PropertyFormFooter({ form: props }: WorkspaceFormProps) {
  if (props.compactForm) return null
  return (<SheetFooter pinned>
    <PropertyDeleteAction form={props} />
    <PropertyFormActions form={props} />
  </SheetFooter>)
}

function PropertyFormFields({ form: props }: WorkspaceFormProps) {
  const phone = useMobileDeviceLayout() === 'phone'
  const editingProperty = props.action === 'editProperty'
  const lockedListKind = isMobileListPropertyKey(props.propertyName)
  const kind = mobilePropertyValueKindForKey(props.propertyName, props.propertyValueKind)
  const keys = editingProperty ? [] : mobilePropertyKeySuggestions(props.notes, props.selectedNote, props.propertyName, props.typeDefinitions)
  const values = mobilePropertyValueSuggestions(props.notes, props.propertyName, props.propertyValue, kind, {
    selectedNote: props.selectedNote, typeDefinitions: props.typeDefinitions,
  })
  return (
    <>
      {!(phone && editingProperty) ? <MobileTextInput
        autoFocus={mobileWorkspaceFormSheetAutoFocus}
        label={mobileText('inspector.properties.propertyName')}
        placeholder={mobileText('inspector.properties.propertyName')}
        testID="workspace-property-name-input"
        value={props.propertyName}
        editable={!editingProperty}
        onChangeText={props.onPropertyNameChange}
      /> : null}
      {keys.length > 0 ? (
        <MobileWorkspaceSuggestionList
          labels={keys}
          maxVisibleItems={mobileWorkspaceFormSheetMaxSuggestions}
          testID="workspace-property-key-suggestions"
          testIDPrefix="workspace-property-key-suggestion"
          onSelect={props.onPropertyNameChange}
        />
      ) : null}
      <MobilePropertyValueEditor
        kind={kind}
        lockedListKind={lockedListKind}
        showKindPicker={!(phone && lockedListKind)}
        propertyName={props.propertyName}
        suggestions={values}
        value={props.propertyValue}
        onKindChange={props.onPropertyValueKindChange}
        onValueChange={props.onPropertyValueChange}
      />
    </>
  )
}

function PropertyFormActions({ form: props }: WorkspaceFormProps) {
  const canSave = canSubmitMobilePropertyValue({ key: props.propertyName, kind: props.propertyValueKind, valueText: props.propertyValue })
  return (<>
    <MobileButton label={mobileText('common.cancel')} testID={mobileWorkspacePropertyActionTestIds.cancel} variant="ghost" onPress={props.onClose} />
    <MobileButton disabled={!canSave} label={mobileText('common.save')} testID={mobileWorkspacePropertyActionTestIds.save} variant="primary" onPress={props.onSaveProperty} />
  </>)
}

function PropertyDeleteAction({ form: props }: WorkspaceFormProps) {
  const note = props.selectedNote
  if (!mobilePropertyDeleteActionVisible({ editingProperty: props.action === 'editProperty', hasSelectedNote: note !== null }) || !note) return null
  return (<MobileButton
    label={mobileText('inspector.properties.deleteProperty')}
    testID={mobileWorkspacePropertyActionTestIds.delete}
    tone="danger"
    variant="ghost"
    onPress={() => props.onDeleteProperty(note.id, props.propertyName)}
  />)
}

export function AddRelationshipContent(props: ActionContentProps) {
  const { styles } = useMobileStyles(createThemeStyles)
  const focusedScroll = useFocusedFormScroll()
  const { compactForm } = props
  return (
    <View style={[styles.formBody, compactForm && phoneSheetStyles.compactBody]}>
      <RelationshipFormHeader form={props} />
      <ScrollView {...focusedScroll} contentContainerStyle={[styles.content, compactForm && phoneSheetStyles.compactContent]} keyboardShouldPersistTaps="handled" style={styles.scrollArea} testID="workspace-relationship-form-scroll">
        <RelationshipFormFields form={props} />
      </ScrollView>
      <RelationshipFormFooter form={props} visible={!compactForm} pinned />
    </View>
  )
}

function RelationshipFormHeader({ form: props }: WorkspaceFormProps) {
  if (!props.compactForm) return null
  return (<MobileToolbar testID="workspace-action-sheet-toolbar">
    <MobileToolbarTitle title={actionTitle(props.action, props.propertyName)} />
    <MobileToolbarSpacer />
    <RelationshipFormActions form={props} />
  </MobileToolbar>)
}

function RelationshipFormFooter({ form, visible, pinned = false }: WorkspaceFormProps & { visible: boolean; pinned?: boolean }) {
  if (!visible) return null
  return (<SheetFooter pinned={pinned}>
    <RelationshipFormActions form={form} />
  </SheetFooter>)
}

function RelationshipFormActions({ form: props }: WorkspaceFormProps) {
  const disabled = props.relationshipName.trim().length === 0 || props.relationshipNoteTitle.trim().length === 0
  return (<>
    <MobileButton label={mobileText('common.cancel')} testID={mobileWorkspaceRelationshipActionTestIds.cancel} variant="ghost" onPress={props.onClose} />
    <MobileButton disabled={disabled} label={mobileText('inspector.relationship.add')} testID={mobileWorkspaceRelationshipActionTestIds.save} variant="primary" onPress={props.onSaveRelationship} />
  </>)
}

function RelationshipFormFields({ form: props }: WorkspaceFormProps) {
  const keySuggestions = mobileRelationshipKeySuggestions(props.notes, props.relationshipName, props.selectedNote, props.typeDefinitions)
  return (<>
    <MobileTextInput
      autoFocus={mobileWorkspaceFormSheetAutoFocus}
      label={mobileText('inspector.relationship.name')}
      placeholder={mobileText('inspector.relationship.name')}
      testID="workspace-relationship-name-input"
      value={props.relationshipName}
      onChangeText={props.onRelationshipNameChange}
    />
    <MobileWorkspaceSuggestionList
      labels={keySuggestions}
      maxVisibleItems={mobileWorkspaceFormSheetMaxSuggestions}
      testID="workspace-relationship-key-suggestions"
      testIDPrefix="workspace-relationship-key-suggestion"
      onSelect={props.onRelationshipNameChange}
    />
    <MobileTextInput
      label={mobileText('inspector.relationship.noteTitle')}
      placeholder={mobileText('inspector.relationship.noteTitle')}
      testID="workspace-relationship-note-title-input"
      value={props.relationshipNoteTitle}
      onChangeText={props.onRelationshipNoteTitleChange}
    />
    <RelationshipTargetOptions form={props} />
  </>)
}

function RelationshipTargetOptions({ form: props }: WorkspaceFormProps) {
  const { styles } = useMobileStyles(createThemeStyles)
  const suggestions = mobileRelationshipTargetSuggestions(props.notes, props.relationshipNoteTitle, {
    relationshipKey: props.relationshipName,
    selectedNote: props.selectedNote,
  })
  const createTargetTitle = props.relationshipNoteTitle.trim()
  const showCreateTarget = shouldShowMobileRelationshipCreateTarget(props.notes, createTargetTitle)

  return (
    <>
      {suggestions.length > 0 ? (
        <View style={styles.suggestionList} testID="workspace-relationship-note-suggestions">
          {suggestions.slice(0, mobileWorkspaceRelationshipTargetMaxSuggestions).map((note) => (
            <Pressable
              accessibilityLabel={note.title}
              accessibilityRole="button"
              key={note.id}
              style={styles.suggestionPressable}
              testID={`workspace-relationship-note-suggestion-${note.id}`}
              onPress={() => props.onRelationshipNoteSelect(note.title, `[[${mobileWikilinkTargetForNote(note, props.selectedNote)}]]`)}
            >
              {({ pressed }) => (
                <View style={[styles.suggestionRow, pressed ? styles.suggestionRowPressed : null]}>
                  <MobileTypeIcon
                    size={16}
                    tone={note.typeTone}
                    type={note.type}
                    typeDefinitions={props.typeDefinitions}
                  />
                  <Text numberOfLines={1} style={styles.suggestionTitle}>{note.title}</Text>
                  <MobileChip label={note.type} tone={chipTone(note.typeTone)} />
                </View>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
      {showCreateTarget ? (
        <CreateRelationshipTargetRow title={createTargetTitle} onPress={props.onCreateRelationshipTarget} />
      ) : null}
    </>
  )
}

function useFocusedFormScroll() {
  const scroll = useRef<ScrollView>(null)
  const viewportHeight = useRef(0)
  const offset = useRef(0)
  const reveal = () => {
    if (Platform.OS === 'web') return
    const field = TextInput.State.currentlyFocusedInput()
    const host = scroll.current?.getNativeScrollRef()
    if (!field || !host) return
    field.measureLayout(host, (_x, fieldTop, _width, fieldHeight) => {
      const next = mobileFormScrollOffset({ offset: offset.current, fieldTop, fieldHeight, viewportHeight: viewportHeight.current })
      if (next !== offset.current) scroll.current?.scrollTo({ y: next, animated: false })
    }, () => {})
  }
  return {
    ref: scroll,
    onLayout: (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height
      reveal()
    },
    onContentSizeChange: reveal,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y
    },
  }
}

function CreateRelationshipTargetRow({
  onPress,
  title,
}: {
  onPress: () => void
  title: string
}) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <Pressable
      accessibilityLabel={`${mobileText('inspector.relationship.createAndOpen')} ${title}`}
      accessibilityRole="button"
      style={styles.suggestionPressable}
      testID={mobileWorkspaceRelationshipActionTestIds.createTarget}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View style={[styles.suggestionRow, pressed ? styles.suggestionRowPressed : null]}>
          <FilePlus color={mobileColors.textMuted} size={16} />
          <Text numberOfLines={1} style={styles.suggestionTitle}>
            {mobileText('inspector.relationship.createAndOpen')} {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}
