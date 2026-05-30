import {
  FormattingToolbar,
  getFormattingToolbarItems,
  PositionPopover,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  useExtension,
  useExtensionState,
} from '@blocknote/react'
import type {
  FloatingUIOptions,
  FormattingToolbarProps,
} from '@blocknote/react'
import {
  blockHasType,
  defaultProps,
  editorHasBlockWithType,
  type DefaultProps,
} from '@blocknote/core'
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import { FormattingToolbarExtension } from '@blocknote/core/extensions'
import { useEditorComposing } from './useEditorComposing'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FC,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
} from 'react'
import {
  Button as MantineButton,
  CheckIcon as MantineCheckIcon,
  Menu as MantineMenu,
} from '@mantine/core'
import {
  ArrowSquareOut as ExternalLink,
  CaretDown as ChevronDown,
  Code as Code2,
  TextB as Bold,
  TextItalic as Italic,
  TextStrikethrough as Strikethrough,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import {
  filterMemoriaFormattingToolbarItems,
  getMemoriaBlockTypeSelectItems,
} from './memoriaEditorFormattingConfig'
import { useBlockNoteFormattingToolbarHoverGuard } from './blockNoteFormattingToolbarHoverGuard'
import { openEditorAttachmentOrUrl } from './editorAttachmentActions'
import {
  isStaleBlockReferenceError,
  reportRecoveredEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'

type MemoriaBasicTextStyle = 'bold' | 'italic' | 'strike' | 'code'

const FORMATTER_CLOSE_GRACE_MS = 160
const FORMATTER_VIEWPORT_PADDING_PX = 8
type MemoriaFloatingOptions = NonNullable<FloatingUIOptions['useFloatingOptions']>
type MemoriaFloatingMiddleware = NonNullable<MemoriaFloatingOptions['middleware']>[number]

function isFocusStillWithinToolbar(
  currentTarget: EventTarget & Element,
  nextTarget: EventTarget | null,
) {
  return nextTarget instanceof Node && currentTarget.contains(nextTarget)
}

function clearToolbarCloseGrace(
  timeoutRef: MutableRefObject<number | null>,
  setCloseGraceActive: Dispatch<SetStateAction<boolean>>,
) {
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }
  setCloseGraceActive(false)
}

function startToolbarCloseGrace(
  timeoutRef: MutableRefObject<number | null>,
  setCloseGraceActive: Dispatch<SetStateAction<boolean>>,
) {
  setCloseGraceActive(true)
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current)
  }
  timeoutRef.current = window.setTimeout(() => {
    timeoutRef.current = null
    setCloseGraceActive(false)
  }, FORMATTER_CLOSE_GRACE_MS)
}

function useFormattingToolbarCloseGrace({
  show,
  toolbarHasFocus,
  toolbarHovered,
}: {
  show: boolean
  toolbarHasFocus: boolean
  toolbarHovered: boolean
}) {
  const [closeGraceActive, setCloseGraceActive] = useState(false)
  const closeGraceTimeoutRef = useRef<number | null>(null)
  const previousShowRef = useRef(show)

  const clearCloseGrace = useCallback(() => {
    clearToolbarCloseGrace(closeGraceTimeoutRef, setCloseGraceActive)
  }, [])

  useEffect(() => {
    const toolbarInteractionActive = show || toolbarHasFocus || toolbarHovered

    if (toolbarInteractionActive) {
      clearCloseGrace()
    } else if (previousShowRef.current) {
      startToolbarCloseGrace(closeGraceTimeoutRef, setCloseGraceActive)
    }

    previousShowRef.current = show
  }, [clearCloseGrace, show, toolbarHasFocus, toolbarHovered])

  useEffect(() => () => {
    if (closeGraceTimeoutRef.current !== null) {
      window.clearTimeout(closeGraceTimeoutRef.current)
    }
  }, [])

  return { closeGraceActive, clearCloseGrace }
}

type FormattingToolbarStore = {
  setState(open: boolean): void
}

function useDeduplicatedFormattingToolbarStore(
  store: FormattingToolbarStore,
  show: boolean,
) {
  const openRef = useRef(show)

  useEffect(() => {
    openRef.current = show
  }, [show])

  return useCallback((open: boolean) => {
    if (openRef.current === open) return
    openRef.current = open
    store.setState(open)
  }, [store])
}

const MEMORIA_BASIC_TEXT_STYLE_TOOLTIPS = {
  bold: {
    label: 'Bold',
    mainTooltip: 'Bold (persists in markdown)',
    secondaryTooltip: '**strong**',
  },
  italic: {
    label: 'Italic',
    mainTooltip: 'Italic (persists in markdown)',
    secondaryTooltip: '*emphasis*',
  },
  strike: {
    label: 'Strikethrough',
    mainTooltip: 'Strikethrough (persists in markdown)',
    secondaryTooltip: '~~strike~~',
  },
  code: {
    label: 'Inline code',
    mainTooltip: 'Inline code (persists in markdown)',
    secondaryTooltip: '`code`',
  },
} satisfies Record<
  MemoriaBasicTextStyle,
  { label: string; mainTooltip: string; secondaryTooltip: string }
>

const MEMORIA_BASIC_TEXT_STYLE_ICONS = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code2,
} satisfies Record<MemoriaBasicTextStyle, PhosphorIcon>

type MemoriaSelectedBlock = ReturnType<
  BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>['getTextCursorPosition']
>['block']

type MemoriaSelectedFileBlock = {
  type: string
  url: string
}

const FORMATTING_TOOLBAR_FILE_BLOCK_TYPES = new Set([
  'audio',
  'file',
  'image',
  'video',
])

type MemoriaBlockTypeSelectOption = ReturnType<
  typeof getMemoriaBlockTypeSelectItems
>[number] & {
  iconElement: ReactElement
  isSelected: boolean
}

function textAlignmentToPlacement(
  textAlignment: DefaultProps['textAlignment'],
) {
  switch (textAlignment) {
    case 'left':
      return 'top-start'
    case 'center':
      return 'top'
    case 'right':
      return 'top-end'
    default:
      return 'top-start'
  }
}

function viewportClampMiddleware(): MemoriaFloatingMiddleware {
  return {
    name: 'memoriaViewportClamp',
    fn({ x, rects }: { rects: { floating: { width: number } }; x: number }) {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const minX = FORMATTER_VIEWPORT_PADDING_PX
      const maxX = Math.max(
        minX,
        viewportWidth - rects.floating.width - FORMATTER_VIEWPORT_PADDING_PX,
      )

      return {
        x: Math.min(Math.max(x, minX), maxX),
      }
    },
  }
}

function withViewportSafeMiddleware(
  options?: MemoriaFloatingOptions,
): MemoriaFloatingOptions {
  if (!options) {
    return {
      middleware: [viewportClampMiddleware()],
    }
  }

  return {
    ...options,
    middleware: [
      ...(options.middleware ?? []),
      viewportClampMiddleware(),
    ],
  }
}

function editorSupportsTextStyle(
  style: MemoriaBasicTextStyle,
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const styleSchema = Reflect.get(editor.schema.styleSchema, style) as {
    type?: string
    propSchema?: unknown
  } | undefined
  return (
    style in editor.schema.styleSchema &&
    styleSchema?.type === style &&
    styleSchema.propSchema === 'boolean'
  )
}

function getSelectedBlocksSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): MemoriaSelectedBlock[] {
  try {
    const selectionBlocks = editor.getSelection()?.blocks
    if (selectionBlocks?.length) {
      return selectionBlocks as MemoriaSelectedBlock[]
    }
  } catch {
    // BlockNote can briefly expose an invalid selection while inline actions remount blocks.
  }

  try {
    return [editor.getTextCursorPosition().block as MemoriaSelectedBlock]
  } catch {
    return []
  }
}

function getCursorBlockSafely(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): MemoriaSelectedBlock | null {
  try {
    return editor.getTextCursorPosition().block as MemoriaSelectedBlock
  } catch {
    return null
  }
}

function selectionSupportsInlineFormatting(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  return getSelectedBlocksSafely(editor).some((block) => block.content !== undefined)
}

function getBasicTextStyleButtonState(
  basicTextStyle: MemoriaBasicTextStyle,
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  if (!editor.isEditable) return undefined
  if (!editorSupportsTextStyle(basicTextStyle, editor)) return undefined
  if (!selectionSupportsInlineFormatting(editor)) return undefined

  return {
    active: basicTextStyle in editor.getActiveStyles(),
  }
}

function getBlockTypeItemIconElement(
  item: ReturnType<typeof getMemoriaBlockTypeSelectItems>[number],
) {
  const Icon = item.icon
  return <Icon size={16} />
}

function isSelectedBlockTypeItem(
  item: ReturnType<typeof getMemoriaBlockTypeSelectItems>[number],
  firstSelectedBlock: MemoriaSelectedBlock,
) {
  if (item.type !== firstSelectedBlock.type) return false

  return Object.entries(item.props || {}).every(
    ([propName, propValue]) =>
      propValue === Reflect.get(firstSelectedBlock.props, propName),
  )
}

function getMemoriaBlockTypeSelectOptions(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  firstSelectedBlock: MemoriaSelectedBlock,
) {
  return getMemoriaBlockTypeSelectItems()
    .filter((item) =>
      editorHasBlockWithType(
        editor,
        item.type,
        Object.fromEntries(
          Object.entries(item.props || {}).map(([propName, propValue]) => [
            propName,
            typeof propValue,
          ]),
        ) as Record<string, 'string' | 'number' | 'boolean'>,
      ),
    )
    .map((item) => ({
      ...item,
      iconElement: getBlockTypeItemIconElement(item),
      isSelected: isSelectedBlockTypeItem(item, firstSelectedBlock),
    }))
}

function getFormattingToolbarBridgeBlockId(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const selectedBlock = getSelectedBlocksSafely(editor).at(0)
  if (!selectedBlock) return null

  return FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(selectedBlock.type)
    ? selectedBlock.id
    : null
}

function getSelectedFileBlockState(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): MemoriaSelectedFileBlock | null {
  const selectedBlocks = getSelectedBlocksSafely(editor)
  if (selectedBlocks.length !== 1) return null

  const block = selectedBlocks.at(0)
  if (!block) return null
  if (!FORMATTING_TOOLBAR_FILE_BLOCK_TYPES.has(block.type)) return null

  const url = (block.props as Record<string, unknown>).url
  return typeof url === 'string' && url.trim().length > 0
    ? { type: block.type, url }
    : null
}

function reportStaleFormattingToolbarBlockReference(error: unknown) {
  reportRecoveredEditorTransformError('stale_block_reference', error)
}

function liveSelectedBlock(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  block: MemoriaSelectedBlock,
) {
  try {
    return editor.getBlock(block.id) as MemoriaSelectedBlock | undefined
  } catch (error) {
    if (isStaleBlockReferenceError(error)) {
      reportStaleFormattingToolbarBlockReference(error)
      return undefined
    }
    throw error
  }
}

function liveSelectedBlocks(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  selectedBlocks: MemoriaSelectedBlock[],
) {
  const liveBlocks: MemoriaSelectedBlock[] = []

  for (const block of selectedBlocks) {
    const liveBlock = liveSelectedBlock(editor, block)
    if (!liveBlock) return []
    liveBlocks.push(liveBlock)
  }

  return liveBlocks
}

function fileDownloadTooltip(dict: unknown, blockType: string): string {
  const tooltip = (dict as {
    formatting_toolbar?: {
      file_download?: {
        tooltip?: Record<string, string>
      }
    }
  }).formatting_toolbar?.file_download?.tooltip

  return (tooltip ? Reflect.get(tooltip, blockType) as string | undefined : undefined) ?? tooltip?.file ?? 'Download file'
}

function getFormattingToolbarAnchorElement(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
) {
  const anchor = editor.domElement?.firstElementChild
  return anchor instanceof Element && anchor.isConnected ? anchor : null
}

function updateSelectedBlocksToType(
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
  selectedBlocks: MemoriaSelectedBlock[],
  item: ReturnType<typeof getMemoriaBlockTypeSelectItems>[number],
) {
  const blocks = liveSelectedBlocks(editor, selectedBlocks)
  if (!blocks.length) return

  try {
    editor.focus()
    editor.transact(() => {
      for (const block of blocks) {
        editor.updateBlock(block.id, {
          type: item.type as never,
          props: item.props as never,
        })
      }
    })
  } catch (error) {
    if (isStaleBlockReferenceError(error)) {
      reportStaleFormattingToolbarBlockReference(error)
      return
    }
    throw error
  }
}

function MemoriaBasicTextStyleButton({
  basicTextStyle,
}: {
  basicTextStyle: MemoriaBasicTextStyle
}) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const buttonState = useEditorState({
    editor,
    selector: ({ editor }) => getBasicTextStyleButtonState(basicTextStyle, editor),
  })

  const toggleStyle = useCallback(() => {
    editor.focus()
    editor.toggleStyles({ [basicTextStyle]: true } as never)
  }, [basicTextStyle, editor])

  if (buttonState === undefined) return null

  const Icon = Reflect.get(MEMORIA_BASIC_TEXT_STYLE_ICONS, basicTextStyle) as PhosphorIcon
  const copy = Reflect.get(MEMORIA_BASIC_TEXT_STYLE_TOOLTIPS, basicTextStyle) as {
    label: string
    mainTooltip: string
    secondaryTooltip: string
  }

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test={basicTextStyle}
      onClick={toggleStyle}
      isSelected={buttonState.active}
      label={copy.label}
      mainTooltip={copy.mainTooltip}
      secondaryTooltip={copy.secondaryTooltip}
      icon={<Icon />}
    />
  )
}

function MemoriaBlockTypeSelect() {
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const selectedBlocks = useEditorState({
    editor,
    selector: ({ editor }): MemoriaSelectedBlock[] => getSelectedBlocksSafely(editor),
  })
  const firstSelectedBlock = selectedBlocks[0] ?? null
  const selectItems = useMemo(
    () => (
      firstSelectedBlock
        ? getMemoriaBlockTypeSelectOptions(editor, firstSelectedBlock)
        : []
    ),
    [editor, firstSelectedBlock],
  )
  const selectedItem = selectItems.find(
    (item): item is MemoriaBlockTypeSelectOption => item.isSelected,
  )

  if (!selectedItem || !editor.isEditable) return null

  return (
    <MantineMenu
      withinPortal={false}
      transitionProps={{ exitDuration: 0 }}
      middlewares={{ flip: true, shift: true, inline: false, size: true }}
    >
      <MantineMenu.Target>
        <MantineButton
          onMouseDown={(event) => {
            event.preventDefault()
            event.currentTarget.focus()
          }}
          leftSection={selectedItem.iconElement}
          rightSection={<ChevronDown size={16} />}
          size="xs"
          variant="subtle"
        >
          {selectedItem.name}
        </MantineButton>
      </MantineMenu.Target>
      <MantineMenu.Dropdown className="bn-select">
        {selectItems.map((item) => (
          <MantineMenu.Item
            key={item.name}
            onClick={() => {
              updateSelectedBlocksToType(editor, selectedBlocks, item)
            }}
            leftSection={item.iconElement}
            rightSection={item.isSelected
              ? <MantineCheckIcon size={10} className="bn-tick-icon" />
              : <div className="bn-tick-space" />}
          >
            {item.name}
          </MantineMenu.Item>
        ))}
      </MantineMenu.Dropdown>
    </MantineMenu>
  )
}

function MemoriaFileDownloadButton({ vaultPath }: { vaultPath?: string }) {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const selectedFileBlock = useEditorState({
    editor,
    selector: ({ editor }) => getSelectedFileBlockState(editor),
  })
  const handleOpen = useCallback(() => {
    if (!selectedFileBlock) return

    editor.focus()
    openEditorAttachmentOrUrl({
      url: selectedFileBlock.url,
      vaultPath,
      source: 'file',
    })
  }, [editor, selectedFileBlock, vaultPath])

  if (!selectedFileBlock || !editor.isEditable) return null

  const label = fileDownloadTooltip(dict, selectedFileBlock.type)
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test="fileDownload"
      onClick={handleOpen}
      isSelected={false}
      label={label}
      mainTooltip={label}
      icon={<ExternalLink />}
    />
  )
}

function replaceToolbarControls(items: ReactElement[], vaultPath?: string) {
  return items.flatMap((item) => {
    switch (String(item.key)) {
      case 'blockTypeSelect':
        return [<MemoriaBlockTypeSelect key={item.key} />]
      case 'boldStyleButton':
        return [<MemoriaBasicTextStyleButton basicTextStyle="bold" key={item.key} />]
      case 'italicStyleButton':
        return [<MemoriaBasicTextStyleButton basicTextStyle="italic" key={item.key} />]
      case 'strikeStyleButton':
        return [<MemoriaBasicTextStyleButton basicTextStyle="strike" key={item.key} />]
      case 'fileDownloadButton':
        return [<MemoriaFileDownloadButton key={item.key} vaultPath={vaultPath} />]
      default:
        return [item]
    }
  })
}

function insertInlineCodeButton(items: ReactElement[]) {
  const strikeButtonIndex = items.findIndex(
    (item) => String(item.key) === 'strikeStyleButton',
  )
  if (strikeButtonIndex === -1) return items

  return [
    ...items.slice(0, strikeButtonIndex + 1),
    <MemoriaBasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />,
    ...items.slice(strikeButtonIndex + 1),
  ]
}

function getMemoriaFormattingToolbarItems(vaultPath?: string) {
  return insertInlineCodeButton(
    replaceToolbarControls(
      filterMemoriaFormattingToolbarItems(
        getFormattingToolbarItems(),
      ),
      vaultPath,
    ),
  )
}

export function MemoriaFormattingToolbar({ vaultPath }: { vaultPath?: string } = {}) {
  return <FormattingToolbar>{getMemoriaFormattingToolbarItems(vaultPath)}</FormattingToolbar>
}

export function MemoriaFormattingToolbarController(props: {
  formattingToolbar?: FC<FormattingToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
}) {
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >()
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor,
  })
  const show = useExtensionState(FormattingToolbarExtension, {
    editor,
  })
  const isComposing = useEditorComposing(editor)
  const [toolbarHasFocus, setToolbarHasFocus] = useState(false)
  const [toolbarHovered, setToolbarHovered] = useState(false)
  const { closeGraceActive, clearCloseGrace } = useFormattingToolbarCloseGrace({
    show,
    toolbarHasFocus,
    toolbarHovered,
  })
  const setFormattingToolbarOpen = useDeduplicatedFormattingToolbarStore(
    formattingToolbar.store,
    show,
  )

  const isOpen = !isComposing
    && (show || toolbarHasFocus || toolbarHovered || closeGraceActive)
  const hasFloatingToolbarAnchor = getFormattingToolbarAnchorElement(editor) !== null
  const shouldRenderFloatingToolbar = isOpen && hasFloatingToolbarAnchor
  const currentBridgeBlockId = useEditorState({
    editor,
    selector: ({ editor }) => getFormattingToolbarBridgeBlockId(editor),
  })

  useBlockNoteFormattingToolbarHoverGuard({
    editor,
    container:
      editor.domElement?.closest('.editor__blocknote-container') ??
      editor.domElement ??
      null,
    selectedFileBlockId: currentBridgeBlockId,
    isOpen,
  })

  const position = useEditorState({
    editor,
    selector: ({ editor }) => (
      shouldRenderFloatingToolbar
        ? {
            from: editor.prosemirrorState.selection.from,
            to: editor.prosemirrorState.selection.to,
          }
        : undefined
    ),
  })

  const placement = useEditorState({
    editor,
    selector: ({ editor }) => {
      const block = getCursorBlockSafely(editor)
      if (!block) return 'top-start'

      if (!blockHasType(block, editor, block.type, {
        textAlignment: defaultProps.textAlignment,
      })) {
        return 'top-start'
      }

      return textAlignmentToPlacement(block.props.textAlignment)
    },
  })

  const floatingUIOptions = useMemo<FloatingUIOptions>(
    () => ({
      ...props.floatingUIOptions,
      useFloatingOptions: {
        open: shouldRenderFloatingToolbar,
        onOpenChange: (open, _event, reason) => {
          setFormattingToolbarOpen(open)
          if (!open) {
            setToolbarHasFocus(false)
            setToolbarHovered(false)
            clearCloseGrace()
          }
          if (reason === 'escape-key') {
            editor.focus()
          }
        },
        placement,
        ...withViewportSafeMiddleware(props.floatingUIOptions?.useFloatingOptions),
      },
      elementProps: {
        style: {
          zIndex: 40,
        },
        ...props.floatingUIOptions?.elementProps,
      },
    }),
    [
      clearCloseGrace,
      editor,
      placement,
      props.floatingUIOptions,
      setFormattingToolbarOpen,
      shouldRenderFloatingToolbar,
    ],
  )

  const Component = props.formattingToolbar || MemoriaFormattingToolbar

  return (
    <PositionPopover position={position} {...floatingUIOptions}>
      {shouldRenderFloatingToolbar && (
        <div
          onPointerEnter={() => {
            setToolbarHovered(true)
          }}
          onPointerLeave={(event) => {
            if (isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) {
              return
            }

            setToolbarHovered(false)
          }}
          onFocusCapture={() => {
            setToolbarHasFocus(true)
          }}
          onBlurCapture={(event) => {
            if (isFocusStillWithinToolbar(event.currentTarget, event.relatedTarget)) {
              return
            }

            setToolbarHasFocus(false)
            setFormattingToolbarOpen(false)
          }}
        >
          <Component />
        </div>
      )}
    </PositionPopover>
  )
}
