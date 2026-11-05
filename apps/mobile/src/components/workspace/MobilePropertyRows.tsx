import { useMobileStyles, useMobileColors } from '../../ui/theme/useMobileTheme'
import { Plus } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import type { MobileLayoutProbe } from '../../qa/mobileLayoutProbe'
import { propertyProbe } from './mobilePropertyRowModel'
import { Text } from '../ui/text'
import { createPropertyPanelStyles } from './MobilePropertiesPanel.styles'


type PropertySectionProps = {
  children: ReactNode
  label: string
  labelVariant?: 'default' | 'placeholder'
  layoutProbe?: MobileLayoutProbe
  layoutProbeId?: string
  testID?: string
}

export function PropertySection(props: PropertySectionProps) {
  const themeStyles = useMobileStyles(createPropertyPanelStyles)
  const { propertyStyles } = themeStyles
  const metricId = props.layoutProbeId ?? props.testID

  return (
    <View {...propertyProbe(props.layoutProbe, metricId, 'row')} style={propertyStyles.sectionRow} testID={props.testID}>
      <Text
        {...propertyProbe(props.layoutProbe, metricId, 'label')}
        style={[propertyStyles.sectionLabel, props.labelVariant === 'placeholder' ? propertyStyles.placeholderLabel : null]}
        testID={props.testID ? `${props.testID}-label` : undefined}
      >
        {props.label}
      </Text>
      <View
        {...propertyProbe(props.layoutProbe, metricId, 'value')}
        style={propertyStyles.sectionValue}
        testID={props.testID ? `${props.testID}-value` : undefined}
      >
        {props.children}
      </View>
    </View>
  )
}

export function PropertyActionRow({
  label,
  layoutProbe,
  layoutProbeId,
  onPress,
  testID,
}: {
  label: string
  layoutProbe?: MobileLayoutProbe
  layoutProbeId?: string
  onPress: () => void
  testID: string
}) {
  const themeStyles = useMobileStyles(createPropertyPanelStyles)
  const { actionStyles } = themeStyles
  const mobileColors = useMobileColors()
  const visibleLabel = label.replace(/^\+\s*/, '')
  const metricId = layoutProbeId ?? testID

  return (
    <Pressable
      {...propertyProbe(layoutProbe, metricId, 'row')}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={actionStyles.row}
      testID={testID}
      onPress={onPress}
    >
      <View {...propertyProbe(layoutProbe, metricId, 'label')} pointerEvents="none" style={actionStyles.label}>
        <View style={actionStyles.iconSlot}>
          <Plus color={mobileColors.textFaint} size={14} />
        </View>
        <Text numberOfLines={1} style={actionStyles.text}>
          {visibleLabel}
        </Text>
      </View>
      <View {...propertyProbe(layoutProbe, metricId, 'value')} pointerEvents="none" style={actionStyles.value} />
    </Pressable>
  )
}

