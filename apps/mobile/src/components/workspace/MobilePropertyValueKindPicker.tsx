import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { mobileColors as propertyColors, mobileRadius } from '../../ui/tokens'
import type { MobilePropertyValueKind } from '../../workspace/mobilePropertyValues'
import { mobilePropertyValueChoiceLayoutContract } from './MobileWorkspaceActionSheetModel'
import { mobilePropertyValueKindOptions } from './mobilePropertyValueKindOptions'

export function MobilePropertyValueKindPicker({
  lockedListKind,
  onSelect,
  selectedKind,
}: {
  lockedListKind: boolean
  onSelect: (value: MobilePropertyValueKind) => void
  selectedKind: MobilePropertyValueKind
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.kindGroup} testID="workspace-property-kind-picker">
      <Text style={styles.kindLabel}>{mobileText('inspector.properties.valueKind')}</Text>
      <View style={styles.kindOptions}>
        {mobilePropertyValueKindOptions.map((option) => (
          <PropertyValueKindButton
            disabled={lockedListKind && option.kind !== 'list'}
            key={option.kind}
            kind={option.kind}
            label={mobileText(option.labelKey)}
            selected={selectedKind === option.kind}
            onPress={() => onSelect(option.kind)}
          />
        ))}
      </View>
    </View>
  )
}

export function MobileBooleanPropertyValuePicker({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const selectedValue = /^(true|yes|1|on)$/iu.test(value.trim()) ? 'true' : 'false'
  return (
    <View style={styles.booleanOptions} testID="workspace-property-boolean-picker">
      <PropertyValueButton
        label={mobileText('inspector.properties.yes')}
        selected={selectedValue === 'true'}
        testID="workspace-property-boolean-yes"
        onPress={() => onChange('true')}
      />
      <PropertyValueButton
        label={mobileText('inspector.properties.no')}
        selected={selectedValue === 'false'}
        testID="workspace-property-boolean-no"
        onPress={() => onChange('false')}
      />
    </View>
  )
}

export function MobileColorPropertyValuePicker({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const selectedValue = value.trim().toLowerCase()

  return (
    <View style={styles.colorOptions} testID="workspace-property-color-picker">
      {propertyColorOptions.map((option) => {
        const selected = option.value.toLowerCase() === selectedValue

        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={option.label}
            style={[
              styles.colorButton,
              {
                backgroundColor: option.softColor,
                borderColor: selected ? option.value : 'transparent',
              },
            ]}
            testID={`workspace-property-color-${option.label}`}
            onPress={() => onChange(option.value)}
          >
            <View style={[styles.colorDot, { backgroundColor: option.value }]} />
          </Pressable>
        )
      })}
    </View>
  )
}

export function MobileStatusPropertyValuePicker({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void
  options: string[]
  value: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  if (options.length === 0) return null

  const selectedValue = value.trim().toLowerCase()

  return (
    <View style={styles.statusOptions} testID="workspace-property-status-picker">
      {options.map((option) => (
        <PropertyValueButton
          key={option}
          label={option}
          selected={option.trim().toLowerCase() === selectedValue}
          testID={`workspace-property-status-${testIdSegment(option)}`}
          onPress={() => onChange(option)}
        />
      ))}
    </View>
  )
}

function PropertyValueKindButton({
  disabled,
  kind,
  label,
  onPress,
  selected,
}: {
  disabled: boolean
  kind: MobilePropertyValueKind
  label: string
  onPress: () => void
  selected: boolean
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <Pressable
      aria-selected={selected}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      style={styles.choicePressable}
      testID={`workspace-property-kind-${kind}`}
      onPress={() => {
        if (!disabled) onPress()
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.kindButton,
            selected ? styles.selectedButton : null,
            disabled ? styles.disabledButton : null,
            pressed && !disabled ? styles.pressedButton : null,
          ]}
        >
          <Text style={[styles.buttonText, selected ? styles.selectedButtonText : null, disabled ? styles.disabledButtonText : null]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

function PropertyValueButton({
  label,
  onPress,
  selected,
  testID,
}: {
  label: string
  onPress: () => void
  selected: boolean
  testID: string
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={styles.choicePressable}
      testID={testID}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View style={[styles.booleanButton, selected ? styles.selectedButton : null, pressed ? styles.pressedButton : null]}>
          <Text style={[styles.buttonText, selected ? styles.selectedButtonText : null]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

const propertyColorOptions = [
  colorOption('gray', propertyColors.textMuted, propertyColors.graySoft),
  colorOption('blue', propertyColors.blue, propertyColors.blueSoft),
  colorOption('green', propertyColors.green, propertyColors.greenSoft),
  colorOption('purple', propertyColors.purple, propertyColors.purpleSoft),
  colorOption('orange', propertyColors.orange, propertyColors.orangeSoft),
  colorOption('red', propertyColors.red, propertyColors.redSoft),
  colorOption('yellow', propertyColors.yellow, propertyColors.yellowSoft),
] as const

function colorOption(label: string, value: string, softColor: string) {
  return { label, softColor, value }
}

function testIdSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = {
    ...choiceLayoutStyles(mobileColors, metrics),
    ...choiceControlStyles(mobileColors, metrics),
    ...choiceStateStyles(mobileColors, metrics),
  }
  return { mobileColors, styles }
}

function choiceLayoutStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { type: mobileType, space: mobileSpace } = metrics
  return StyleSheet.create({
    booleanOptions: {
      flexDirection: 'row',
      gap: metrics.size(mobilePropertyValueChoiceLayoutContract.gap),
    },
    colorOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: mobileSpace.xs,
    },
    kindGroup: {
      gap: mobileSpace.xs,
    },
    kindLabel: {
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
    },
    kindOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: metrics.size(mobilePropertyValueChoiceLayoutContract.gap),
    },
    statusOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: metrics.size(mobilePropertyValueChoiceLayoutContract.gap),
    },
  })
}

function choiceControlStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  return StyleSheet.create({
    booleanButton: {
      minHeight: metrics.size(mobilePropertyValueChoiceLayoutContract.minHeight),
      minWidth: metrics.size(mobilePropertyValueChoiceLayoutContract.minWidth),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: mobileColors.control,
      borderColor: mobileColors.border,
      borderRadius: mobilePropertyValueChoiceLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: metrics.size(mobilePropertyValueChoiceLayoutContract.paddingHorizontal),
    },
    colorButton: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      borderRadius: mobileRadius.pill,
      borderWidth: 2,
    },
    colorDot: {
      width: 14,
      height: 14,
      borderRadius: mobileRadius.pill,
    },
    choicePressable: {
      borderRadius: mobilePropertyValueChoiceLayoutContract.radius,
    },
    kindButton: {
      minHeight: metrics.size(mobilePropertyValueChoiceLayoutContract.minHeight),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: mobileColors.control,
      borderColor: mobileColors.border,
      borderRadius: mobilePropertyValueChoiceLayoutContract.radius,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: metrics.size(mobilePropertyValueChoiceLayoutContract.paddingHorizontal),
    },
  })
}

function choiceStateStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { type: mobileType } = metrics
  return StyleSheet.create({
    buttonText: {
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
      fontWeight: '500',
    },
    disabledButton: {
      opacity: 0.45,
    },
    disabledButtonText: {
      color: mobileColors.textFaint,
    },
    pressedButton: {
      backgroundColor: mobileColors.graySoft,
    },
    selectedButton: {
      backgroundColor: mobileColors.selected,
      borderColor: mobileColors.primary,
    },
    selectedButtonText: {
      color: mobileColors.primary,
    },
  })
}
