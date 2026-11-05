import {
  expectAtLeast,
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'

type WysiwygEditorMetrics = {
  form: NativeLayoutMetric | undefined
  richText: NativeLayoutMetric | undefined
  toolbar: NativeLayoutMetric | undefined
  toolbarHost: NativeLayoutMetric | undefined
}

const wysiwygToolbarActionMetricIds = [
  'editor.wysiwyg.toolbar.action.bold',
  'editor.wysiwyg.toolbar.action.italic',
  'editor.wysiwyg.toolbar.action.link',
  'editor.wysiwyg.toolbar.action.wikilink',
  'editor.wysiwyg.toolbar.group.headings',
  'editor.wysiwyg.toolbar.group.lists',
  'editor.wysiwyg.toolbar.group.insert',
  'editor.wysiwyg.toolbar.group.more',
] as const

export const nativeWysiwygEditorMetricContract = {
  minFormHeight: 320,
  toolbarActionCount: wysiwygToolbarActionMetricIds.length,
  toolbarActionGap: 4,
  toolbarActionSize: 44,
  toolbarHostPaddingHorizontal: 12,
  toolbarHostPaddingTop: 4,
} as const

export const assertNativeWysiwygEditorLayoutMetrics = (
  metrics: NativeLayoutMetricMap,
): NativeLayoutAssertionFailure[] => {
  const editor = wysiwygEditorMetrics(metrics)

  return [
    ...assertWysiwygEditorSurfaceLayout(editor),
    ...assertWysiwygToolbarActionLayouts(metrics),
  ]
};

const wysiwygEditorMetrics = (metrics: NativeLayoutMetricMap): WysiwygEditorMetrics => {
  return {
    form: metrics['editor.wysiwyg.form'],
    richText: metrics['editor.wysiwyg.richText'],
    toolbar: metrics['editor.wysiwyg.toolbar'],
    toolbarHost: metrics['editor.wysiwyg.toolbarHost'],
  }
};

const assertWysiwygEditorSurfaceLayout = (editor: WysiwygEditorMetrics): NativeLayoutAssertionFailure[] => {
  return [
    ...assertWysiwygEditorMetricsCaptured(editor),
    ...assertWysiwygEditorFormLayout(editor),
    ...assertWysiwygToolbarHostLayout(editor),
    ...assertWysiwygToolbarInsetLayout(editor),
  ]
};

const assertWysiwygEditorMetricsCaptured = (editor: WysiwygEditorMetrics): NativeLayoutAssertionFailure[] => {
  return [
    ...expectMetric({
      id: 'editor.wysiwyg.form',
      message: 'WYSIWYG editor form is captured before checking native editor layout',
      metric: editor.form,
    }),
    ...expectMetric({
      id: 'editor.wysiwyg.richText',
      message: 'WYSIWYG editor content surface is captured before checking native editor layout',
      metric: editor.richText,
    }),
    ...expectMetric({
      id: 'editor.wysiwyg.toolbarHost',
      message: 'WYSIWYG toolbar host is captured before checking native editor layout',
      metric: editor.toolbarHost,
    }),
    ...expectMetric({
      id: 'editor.wysiwyg.toolbar',
      message: 'WYSIWYG toolbar is captured before checking native editor layout',
      metric: editor.toolbar,
    }),
  ]
};

const assertWysiwygEditorFormLayout = (editor: WysiwygEditorMetrics): NativeLayoutAssertionFailure[] => {
  return [
    ...expectAtLeast({
      actual: editor.form?.height ?? null,
      expected: nativeWysiwygEditorMetricContract.minFormHeight,
      id: 'editor.wysiwyg.form',
      message: 'WYSIWYG editor keeps a usable native editing surface',
    }),
  ]
};

const assertWysiwygToolbarHostLayout = (editor: WysiwygEditorMetrics): NativeLayoutAssertionFailure[] => {
  return [
    ...expectClose({
      actual: editor.toolbarHost?.x ?? null,
      expected: 0,
      id: 'editor.wysiwyg.toolbarHost',
      message: 'WYSIWYG toolbar host starts at the editor edge',
    }),
    ...expectClose({
      actual: editor.form && editor.toolbarHost ? editor.form.width - editor.toolbarHost.width : null,
      expected: 0,
      id: 'editor.wysiwyg.toolbarHost',
      message: 'WYSIWYG toolbar host spans the editor width',
    }),
    ...expectClose({
      actual: editor.form && editor.toolbarHost
        ? editor.form.height - editor.toolbarHost.y - editor.toolbarHost.height
        : null,
      expected: 0,
      id: 'editor.wysiwyg.toolbarHost',
      message: 'WYSIWYG toolbar stays pinned to the editor bottom',
    }),
  ]
};

const assertWysiwygToolbarInsetLayout = (editor: WysiwygEditorMetrics): NativeLayoutAssertionFailure[] => {
  return [
    ...expectClose({
      actual: editor.toolbar?.x ?? null,
      expected: nativeWysiwygEditorMetricContract.toolbarHostPaddingHorizontal,
      id: 'editor.wysiwyg.toolbar',
      message: 'WYSIWYG toolbar keeps desktop horizontal inset',
    }),
    ...expectClose({
      actual: editor.toolbar?.y ?? null,
      expected: nativeWysiwygEditorMetricContract.toolbarHostPaddingTop,
      id: 'editor.wysiwyg.toolbar',
      message: 'WYSIWYG toolbar keeps desktop top inset',
    }),
  ]
};

const assertWysiwygToolbarActionLayouts = (metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] => {
  return [
    ...wysiwygToolbarActionMetricIds.flatMap((id) => assertWysiwygToolbarActionSize(id, metrics[id])),
    ...assertWysiwygToolbarActionSequence(metrics),
  ]
};

const assertWysiwygToolbarActionSize = (
  id: string,
  action: NativeLayoutMetric | undefined,
): NativeLayoutAssertionFailure[] => {
  return [
    ...expectMetric({
      id,
      message: 'WYSIWYG toolbar action is captured before checking native toolbar parity',
      metric: action,
    }),
    ...expectClose({
      actual: action?.width ?? null,
      expected: nativeWysiwygEditorMetricContract.toolbarActionSize,
      id,
      message: 'WYSIWYG toolbar action keeps tablet touch target width',
    }),
    ...expectClose({
      actual: action?.height ?? null,
      expected: nativeWysiwygEditorMetricContract.toolbarActionSize,
      id,
      message: 'WYSIWYG toolbar action keeps tablet touch target height',
    }),
  ]
};

const assertWysiwygToolbarActionSequence = (metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] => {
  return wysiwygToolbarActionMetricIds.slice(1).flatMap((id, index) => {
    const previous = metrics[wysiwygToolbarActionMetricIds[index]]
    const current = metrics[id]

    return [
      ...expectClose({
        actual: previous && current ? current.x - previous.x - previous.width : null,
        expected: nativeWysiwygEditorMetricContract.toolbarActionGap,
        id,
        message: 'WYSIWYG toolbar action keeps desktop action gap',
      }),
      ...expectClose({
        actual: previous && current ? current.y - previous.y : null,
        expected: 0,
        id,
        message: 'WYSIWYG toolbar actions stay aligned on the same row',
      }),
    ]
  })
};
