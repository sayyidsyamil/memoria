import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import { useMobileColors } from '../../ui/theme/useMobileTheme'
import { mobileFilePreviewSource } from '../../workspace/mobileFilePreviewSource'
import type { MobileNote } from '../../workspace/mobileWorkspaceModel'

type PreviewProps = { fallback: ReactNode; note: MobileNote; vaultRootUri?: string | null }
type FileSourceProps = { fallback: ReactNode; uri: string; label: string }

export function MobileFilePreview({ fallback, note, vaultRootUri }: PreviewProps) {
  const source = mobileFilePreviewSource(note, vaultRootUri)
  if (!source) return fallback
  const props = { fallback, label: note.path ?? note.id, uri: source.uri }
  if (source.kind === 'image') return <LocalImagePreview key={source.uri} {...props} />
  return Platform.OS === 'ios' ? <LocalPdfPreview key={source.uri} {...props} /> : fallback
}

function LocalImagePreview({ fallback, label, uri }: FileSourceProps) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const colors = useMobileColors()
  const failedPreview = usePreviewAnalytics('image')
  if (failed) return fallback
  return (
    <View style={[styles.host, { backgroundColor: colors.editor }]} testID="file-image-preview"
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
      <ScrollView style={styles.host} minimumZoomScale={1} maximumZoomScale={4}
        contentInsetAdjustmentBehavior="never" bounces={false} bouncesZoom={false}
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
        <Image accessibilityLabel={label} accessible resizeMode="contain" source={{ uri }} style={size}
          onLoad={() => setLoaded(true)} onError={() => { failedPreview(); setFailed(true) }} testID="file-preview-image" />
      </ScrollView>
      {!loaded ? <PreviewLoading /> : null}
    </View>
  )
}

function LocalPdfPreview({ fallback, label, uri }: FileSourceProps) {
  const [failed, setFailed] = useState(false)
  const failedPreview = usePreviewAnalytics('pdf')
  const fail = () => { failedPreview(); setFailed(true) }
  if (failed) return fallback
  return (
    <WebView accessibilityLabel={label} source={{ uri }} style={styles.host} testID="file-pdf-preview"
      allowingReadAccessToURL={uri} javaScriptEnabled={false} allowFileAccess
      allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      originWhitelist={['*']} onShouldStartLoadWithRequest={({ url }) => url === uri || url === 'about:blank'}
      onError={fail} onContentProcessDidTerminate={fail}
      startInLoadingState renderLoading={() => <PreviewLoading />} />
  )
}

function usePreviewAnalytics(kind: 'image' | 'pdf') {
  const analytics = useMobileAnalytics()
  const opened = useRef(false)
  const failed = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    analytics.capture({ name: 'file_preview_opened', preview_kind: kind })
  }, [analytics, kind])
  return () => {
    if (failed.current) return
    failed.current = true
    analytics.capture({ name: 'file_preview_failed', preview_kind: kind })
  }
}

function PreviewLoading() {
  const colors = useMobileColors()
  return <View pointerEvents="none" style={styles.loading} testID="file-preview-loading">
    <ActivityIndicator color={colors.textMuted} />
  </View>
}

const styles = StyleSheet.create({
  host: { flex: 1, minHeight: 0 },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
})
