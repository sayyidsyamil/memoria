import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { useMemo, useState } from 'react'
import { useMobileModalDismiss } from '../../workspace/useMobileModalDismiss'
import { Pressable, StyleSheet, View } from 'react-native'
import { mobileText } from '../../i18n/mobileText'
import { MobileButton } from '../../ui/MobileButton'
import { MobilePanel, MobileToolbar, MobileToolbarSpacer, MobileToolbarTitle } from '../../ui/MobilePanel'
import { MobileTextInput } from '../../ui/MobileTextInput'

import {
  nativeWysiwygCanSaveExternalLink,
  nativeWysiwygNormalizedExternalLink,
} from './MobileWysiwygExternalLinkSheetModel'

type MobileWysiwygExternalLinkSheetProps = {
  initialUrl: string
  onApply: (url: string) => void
  onClose: () => void
  onRemove: () => void
}

export function MobileWysiwygExternalLinkSheet({
  initialUrl,
  onApply,
  onClose,
  onRemove,
}: MobileWysiwygExternalLinkSheetProps) {
  useMobileModalDismiss(onClose)
  const { styles } = useMobileStyles(createThemeStyles)
  const [url, setUrl] = useState(initialUrl)
  const normalizedUrl = useMemo(() => nativeWysiwygNormalizedExternalLink(url), [url])
  const canSave = nativeWysiwygCanSaveExternalLink(url)
  const hasExistingLink = initialUrl.length > 0

  const saveLink = () => {
    if (normalizedUrl) onApply(normalizedUrl)
  }

  return (
    <View style={styles.host} testID="editor-wysiwyg-link-sheet">
      <Pressable style={styles.backdrop} testID="editor-wysiwyg-link-backdrop" onPress={onClose} />
      <MobilePanel style={styles.panel}>
        <MobileToolbar testID="editor-wysiwyg-link-toolbar">
          <MobileToolbarTitle title={mobileText('editor.formatting.link')} />
          <MobileToolbarSpacer />
          <MobileButton label={mobileText('common.cancel')} variant="ghost" onPress={onClose} />
        </MobileToolbar>
        <View style={styles.content}>
          <MobileTextInput
            autoFocus
            keyboardType="url"
            label={mobileText('inspector.properties.valueKind.url')}
            returnKeyType="done"
            testID="editor-wysiwyg-link-url"
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={saveLink}
          />
          <View style={styles.footer}>
            {hasExistingLink ? (
              <MobileButton
                label={mobileText('common.remove')}
                style={styles.removeButton}
                variant="ghost"
                onPress={onRemove}
              />
            ) : null}
            <MobileToolbarSpacer />
            <MobileButton disabled={!canSave} label={mobileText('common.save')} onPress={saveLink} />
          </View>
        </View>
      </MobilePanel>
    </View>
  )
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace } = metrics
  const styles = StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFill,
    },
    content: {
      gap: mobileSpace.md,
      padding: mobileSpace.md,
    },
    footer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
    },
    host: {
      ...StyleSheet.absoluteFill,
      justifyContent: 'flex-end',
      padding: mobileSpace.md,
    },
    panel: {
      borderColor: mobileColors.border,
      borderWidth: StyleSheet.hairlineWidth,
      shadowColor: mobileColors.text,
      shadowOffset: { height: 12, width: 0 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
    },
    removeButton: {
      alignSelf: 'flex-start',
    },
  })
  return { mobileColors, styles }
}
