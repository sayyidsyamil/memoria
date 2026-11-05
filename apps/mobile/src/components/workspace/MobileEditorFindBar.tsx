import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { CaretDown, CaretUp, X } from 'phosphor-react-native'
import { Input } from '../ui/input'
import { Text } from '../ui/text'
import { MobileButton } from '../../ui/MobileButton'
import { Button } from '../ui/button'
import { mobileText } from '../../i18n/mobileText'
import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileFindRequest, MobileFindSnapshot } from './MobileWysiwygFindBridge'

export function MobileEditorFindBar({ snapshot, onRequest, onClose, replace }: {
  snapshot: MobileFindSnapshot
  onRequest: (request: MobileFindRequest) => void
  onClose: () => void
  replace: boolean
}) {
  const { styles, mobileColors } = useMobileStyles(createStyles)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ caseSensitive: false, regex: false })
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(replace)
  const updateQuery = (value: string) => {
    setQuery(value)
    onRequest({ kind: 'query', query: value, options })
  }
  const toggle = (key: keyof typeof options) => {
    const next = { ...options, [key]: !options[key] }
    setOptions(next)
    onRequest({ kind: 'query', query, options: next })
  }
  return (
    <View style={styles.bar} testID="editor-inline-find">
      <View style={styles.row}>
        <Input autoFocus value={query} onChangeText={updateQuery} autoCapitalize="none" autoCorrect={false}
          accessibilityLabel={mobileText('editor.find.findLabel')} placeholder={mobileText('editor.find.findPlaceholder')}
          style={styles.input} testID="workspace-find-input" submitBehavior="submit"
          onSubmitEditing={() => onRequest({ kind: 'move', direction: 1 })}
          onKeyPress={(event) => { if (event.nativeEvent.key === 'Escape') onClose() }} />
        <Text style={styles.status} testID="workspace-find-count">{findStatus(snapshot)}</Text>
        <FindAction accessibilityLabel={mobileText('editor.find.close')} onPress={onClose} testID="workspace-find-close">
          <X color={mobileColors.textMuted} size={18} />
        </FindAction>
      </View>
      <View style={styles.row}>
        <FindAction accessibilityLabel={mobileText('editor.find.matchCase')} selected={options.caseSensitive} onPress={() => toggle('caseSensitive')} testID="workspace-find-case">
          <Text style={styles.status}>Aa</Text>
        </FindAction>
        <FindAction accessibilityLabel={mobileText('editor.find.regex')} selected={options.regex} onPress={() => toggle('regex')} testID="workspace-find-regex">
          <Text style={styles.status}>.*</Text>
        </FindAction>
        <FindAction accessibilityLabel={mobileText(showReplace ? 'editor.find.hideReplace' : 'editor.find.showReplace')} selected={showReplace} onPress={() => setShowReplace(!showReplace)} testID="workspace-find-show-replace">
          <CaretDown color={mobileColors.textMuted} size={18} />
        </FindAction>
        <View style={styles.spacer} />
        <FindAction accessibilityLabel={mobileText('editor.find.previousMatch')} onPress={() => onRequest({ kind: 'move', direction: -1 })} testID="workspace-find-previous">
          <CaretUp color={mobileColors.textMuted} size={18} />
        </FindAction>
        <FindAction accessibilityLabel={mobileText('editor.find.nextMatch')} onPress={() => onRequest({ kind: 'move', direction: 1 })} testID="workspace-find-next">
          <CaretDown color={mobileColors.textMuted} size={18} />
        </FindAction>
      </View>
      {showReplace && <View style={styles.row}>
        <Input value={replacement} onChangeText={setReplacement} autoCapitalize="none" autoCorrect={false}
          accessibilityLabel={mobileText('editor.find.replaceLabel')} placeholder={mobileText('editor.find.replacePlaceholder')}
          style={styles.input} testID="workspace-replace-input" />
        <MobileButton label={mobileText('editor.find.replace')} disabled={!snapshot.matchCount}
          onPress={() => onRequest({ kind: 'replace', replacement, all: false })} testID="workspace-replace-current" />
        <MobileButton label={mobileText('editor.find.replaceAll')} disabled={!snapshot.matchCount}
          onPress={() => onRequest({ kind: 'replace', replacement, all: true })} testID="workspace-replace-all" />
      </View>}
    </View>
  )
}

function FindAction({ selected = false, ...props }: { accessibilityLabel: string; children: ReactNode; onPress: () => void; selected?: boolean; testID: string }) {
  const { styles } = useMobileStyles(createStyles)
  return <Button {...props} size="icon" variant="ghost" accessibilityState={{ selected }} style={[styles.action, selected && styles.selected]} />
}

function findStatus(snapshot: MobileFindSnapshot) {
  if (snapshot.error) return mobileText('editor.find.invalidRegex')
  if (!snapshot.matchCount) return mobileText('editor.find.noMatches')
  return mobileText('editor.find.matchCount').replace('{current}', String(snapshot.activeIndex + 1)).replace('{total}', String(snapshot.matchCount))
}

function createStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  return { mobileColors, styles: StyleSheet.create({
    bar: { paddingHorizontal: metrics.size(12), paddingVertical: metrics.size(4), gap: metrics.size(4), borderBottomWidth: 1, borderColor: mobileColors.border, backgroundColor: mobileColors.editor },
    row: { flexDirection: 'row', alignItems: 'center', gap: metrics.size(4), flexWrap: 'wrap' },
    input: { flex: 1, minWidth: 100, minHeight: 40, paddingHorizontal: metrics.size(8), color: mobileColors.text, backgroundColor: mobileColors.control, borderColor: mobileColors.border, borderWidth: 1, borderRadius: 6, fontSize: metrics.type.body },
    status: { color: mobileColors.textMuted, fontSize: metrics.size(12) },
    spacer: { flex: 1 },
    action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    selected: { backgroundColor: mobileColors.selected },
  }) }
}
