import { useCallback } from 'react'
import { LinkToolbarExtension } from '@blocknote/core/extensions'
import {
  GridSuggestionMenuController,
  LinkToolbarController,
  SideMenuController,
  SuggestionMenuController,
  type FormattingToolbarProps,
  type SideMenuProps,
  type useCreateBlockNote,
} from '@blocknote/react'
import type { AppLocale } from '../lib/i18n'
import { errorMessageIncludes } from '../utils/vaultErrors'
import { MemoriaFilePanelController } from './MemoriaFilePanel'
import { MemoriaLinkToolbar } from './MemoriaLinkToolbar'
import { MemoriaSlashMenu } from './MemoriaSlashMenu'
import { WikilinkSuggestionMenu, type WikilinkSuggestionItem } from './WikilinkSuggestionMenu'
import { MemoriaCollapsedHeadingsController, MemoriaSideMenu } from './memoriaBlockNoteSideMenu'
import { MemoriaFormattingToolbar, MemoriaFormattingToolbarController } from './memoriaEditorFormatting'
import type { SuggestionAction } from './singleEditorSuggestionItems'
import type { useSuggestionMenuItems } from './singleEditorSuggestionItems'

type EditorInteractionControllersProps = ReturnType<typeof useSuggestionMenuItems> & {
  editor: ReturnType<typeof useCreateBlockNote>
  locale: AppLocale
  onToolbarMouseDown: (event: Pick<React.MouseEvent<HTMLElement>, 'target' | 'preventDefault'>) => void
  runEditorAction: (action: SuggestionAction) => void
  vaultPath?: string
}

type LinkToolbarElementLookup = {
  getLinkElementAtPos: (position: number) => HTMLAnchorElement | null
}

const guardedLinkToolbarExtensions = new WeakSet<LinkToolbarElementLookup>()

function isUnavailableEditorViewError(error: unknown) {
  return errorMessageIncludes(error, '[tiptap error]', 'editor view is not available')
}

function guardLinkToolbarElementLookup(extension: LinkToolbarElementLookup) {
  if (guardedLinkToolbarExtensions.has(extension)) return

  const getLinkElementAtPos = extension.getLinkElementAtPos.bind(extension)
  extension.getLinkElementAtPos = (position) => {
    try {
      return getLinkElementAtPos(position)
    } catch (error) {
      if (isUnavailableEditorViewError(error)) return null
      throw error
    }
  }
  guardedLinkToolbarExtensions.add(extension)
}

function MemoriaLinkToolbarController({
  editor,
  ...props
}: React.ComponentProps<typeof LinkToolbarController> & Pick<EditorInteractionControllersProps, 'editor'>) {
  const extension = editor.getExtension?.(LinkToolbarExtension)
  if (extension) guardLinkToolbarElementLookup(extension)

  return <LinkToolbarController {...props} />
}

function EditorToolbarControllers({
  editor,
  locale,
  onToolbarMouseDown,
  vaultPath,
}: Pick<EditorInteractionControllersProps, 'editor' | 'locale' | 'onToolbarMouseDown' | 'vaultPath'>) {
  const sideMenu = useCallback((props: SideMenuProps) => <MemoriaSideMenu {...props} locale={locale} />, [locale])
  const formattingToolbar = useCallback(
    (props: FormattingToolbarProps) => (
      <MemoriaFormattingToolbar {...props} locale={locale} vaultPath={vaultPath} />
    ),
    [locale, vaultPath],
  )
  const linkToolbar = useCallback(
    (props: React.ComponentProps<typeof MemoriaLinkToolbar>) => (
      <MemoriaLinkToolbar {...props} vaultPath={vaultPath} />
    ),
    [vaultPath],
  )
  const floatingUIOptions = { elementProps: { onMouseDownCapture: onToolbarMouseDown } }

  return (
    <>
      <MemoriaCollapsedHeadingsController />
      <SideMenuController sideMenu={sideMenu} />
      <MemoriaFormattingToolbarController
        formattingToolbar={formattingToolbar}
        floatingUIOptions={floatingUIOptions}
      />
      <MemoriaLinkToolbarController
        editor={editor}
        linkToolbar={linkToolbar}
        floatingUIOptions={floatingUIOptions}
      />
      <MemoriaFilePanelController />
    </>
  )
}

function EditorSuggestionControllers({
  getAtWikilinkItems,
  getEmojiItems,
  getSlashMenuItems,
  getWikilinkItems,
  runEditorAction,
}: Pick<
  EditorInteractionControllersProps,
  'getAtWikilinkItems' | 'getEmojiItems' | 'getSlashMenuItems' | 'getWikilinkItems' | 'runEditorAction'
>) {
  const handleItemClick = useCallback(
    (item: WikilinkSuggestionItem) => runEditorAction(item.onItemClick),
    [runEditorAction],
  )

  return (
    <>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getSlashMenuItems}
        suggestionMenuComponent={MemoriaSlashMenu}
      />
      <GridSuggestionMenuController triggerCharacter=":" columns={10} minQueryLength={1} getItems={getEmojiItems} />
      <SuggestionMenuController
        triggerCharacter="[["
        getItems={getWikilinkItems}
        suggestionMenuComponent={WikilinkSuggestionMenu}
        onItemClick={handleItemClick}
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={getAtWikilinkItems}
        suggestionMenuComponent={WikilinkSuggestionMenu}
        onItemClick={handleItemClick}
      />
    </>
  )
}

export function EditorInteractionControllers(props: EditorInteractionControllersProps) {
  return (
    <>
      <EditorToolbarControllers {...props} />
      <EditorSuggestionControllers {...props} />
    </>
  )
}
