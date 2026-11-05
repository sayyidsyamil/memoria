import { useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '../ui/text'
import { MobileButton } from '../../ui/MobileButton'
import { mobileText } from '../../i18n/mobileText'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { completeConflictChoices, type SyncConflictChoices, type SyncConflictFile, type SyncConflictVersion } from '../../workspace/syncConflictModel'

type Props = { files: SyncConflictFile[]; busy: boolean; failure: 'stale' | 'local' | null; cancel: () => void; apply: (choices: SyncConflictChoices) => void }

export function MobileConflictReview({ files, busy, failure, cancel, apply }: Props) {
  const styles = useMobileStyles(createStyles)
  const [choices, setChoices] = useState<SyncConflictChoices>({})
  const [selected, setSelected] = useState(files[0]?.path)
  const file = files.find(item => item.path === selected)
  const wide = useWindowDimensions().width >= 760
  const disabled = cannotApply(files, choices, busy, failure)
  return <View style={styles.root} testID="sync-conflict-review">
    {!files.length && <Text style={styles.label}>{mobileText('mobile.sync.noConflicts')}</Text>}
    <View style={[styles.body, wide && styles.horizontal]}>
      <FlatList style={wide ? styles.fileSidebar : styles.fileList} data={files} keyExtractor={item => item.path} extraData={{ selected, choices }}
        renderItem={({ item }) => <ConflictFile file={item} selected={selected} select={setSelected} />}
      />
      {file && <View style={styles.comparison}>
        <View style={[styles.versions, wide && styles.horizontal]}>
          <Version version={file.local} label={mobileText('mobile.sync.localVersion')} />
          <Version version={file.remote} label={mobileText('mobile.sync.remoteVersion')} />
        </View>
        <Choices selected={choices[file.path]} busy={busy} choose={choice => setChoices(previous => ({ ...previous, [file.path]: choice }))} />
      </View>}
    </View>
    {failure && <Text accessibilityRole="alert" style={styles.failure}>{mobileText(`mobile.sync.${failure}`)}</Text>}
    <View style={styles.actions}>
      <MobileButton disabled={busy} label={mobileText('common.cancel')} onPress={cancel} style={styles.touch} />
      <MobileButton disabled={disabled} label={mobileText('mobile.sync.continue')} variant="primary"
        onPress={() => apply(choices)} style={styles.touch} testID="conflict-apply" />
    </View>
  </View>
}

function ConflictFile({ file, selected, select }: { file: SyncConflictFile; selected: string | undefined; select: (path: string) => void }) {
  const styles = useMobileStyles(createStyles)
  const active = file.path === selected
  return <MobileButton style={styles.file} label={file.path} variant={active ? 'primary' : 'ghost'}
    accessibilityState={{ selected: active }} onPress={() => select(file.path)} testID={`conflict-file-${file.path}`} />
}

function cannotApply(files: SyncConflictFile[], choices: SyncConflictChoices, busy: boolean, failure: Props['failure']) {
  return busy || Boolean(failure) || !completeConflictChoices(files, choices)
}

function Choices({ selected, busy, choose }: { selected: SyncConflictChoices[string] | undefined; busy: boolean; choose: (choice: SyncConflictChoices[string]) => void }) {
  const styles = useMobileStyles(createStyles)
  const labels = { local: 'editor.banner.keepMine', remote: 'editor.banner.keepTheirs', both: 'mobile.sync.keepBoth' } as const
  return <View style={styles.actions}>{(['local', 'remote', 'both'] as const).map(choice => <MobileButton key={choice} disabled={busy}
    label={mobileText(labels[choice])} variant={selected === choice ? 'primary' : 'secondary'} style={styles.touch}
    accessibilityState={{ selected: selected === choice }} testID={`conflict-choice-${choice}`} onPress={() => choose(choice)} />)}</View>
}

function Version({ version, label }: { version: SyncConflictVersion; label: string }) {
  const styles = useMobileStyles(createStyles)
  return <View style={styles.version}>
    <Text style={styles.label}>{label}</Text>
    <ScrollView style={styles.preview}><Text selectable style={styles.code}>{version.kind === 'text' ? version.text : mobileText(`mobile.sync.${version.kind}`)}</Text></ScrollView>
    {version.truncated && <Text style={styles.label}>{mobileText('mobile.sync.previewTruncated')}</Text>}
  </View>
}

function createStyles(colors: MobileColors, metrics: MobileMetrics) {
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, padding: metrics.space.md, gap: metrics.space.md },
    body: { flex: 1, minHeight: 0, gap: metrics.space.md },
    horizontal: { flexDirection: 'row' },
    fileSidebar: { width: 200, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border },
    fileList: { maxHeight: 100, flexGrow: 0 },
    file: { minHeight: 44, justifyContent: 'flex-start', marginBottom: 4 },
    comparison: { flex: 1, minWidth: 0, gap: metrics.space.md },
    versions: { flex: 1, minHeight: 0, gap: metrics.space.md },
    version: { flex: 1, minHeight: 0, minWidth: 0, gap: metrics.space.sm },
    label: { color: colors.textMuted, fontSize: metrics.size(12) },
    preview: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.control },
    code: { padding: metrics.space.md, color: colors.text, fontFamily: 'monospace', fontSize: metrics.size(12), lineHeight: metrics.size(18) },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.space.sm },
    touch: { minHeight: 44 },
    failure: { color: colors.danger, fontSize: metrics.size(12) },
  })
}
