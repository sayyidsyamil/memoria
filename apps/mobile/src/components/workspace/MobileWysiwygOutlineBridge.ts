import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import type { MobileTableOfContentsTarget } from '../../workspace/mobileTableOfContents'

type OutlineHeading = {
  level: number
  title: string
}
type OutlineScrollRequest = {
  payload: {
    documentTitle: string
    messageId: string
    target: MobileTableOfContentsTarget
  }
  type: 'scroll-mobile-outline-target'
}
type OutlineScrollResponse = {
  payload: MobileWysiwygOutlineScrollResult & { messageId: string }
  type: 'mobile-outline-target-scrolled'
}
type OutlineBridgeMessage = OutlineScrollRequest | OutlineScrollResponse
type PendingOutlineScroll = {
  resolve: (result: MobileWysiwygOutlineScrollResult) => void
  timeout: ReturnType<typeof setTimeout>
}

export type MobileWysiwygOutlineScrollResult = {
  afterY: number
  beforeY: number
  expectedY: number
  found: boolean
  targetId: string
}
export type MobileWysiwygOutlineEditorBridge = {
  scrollToMobileOutlineTarget: (
    target: MobileTableOfContentsTarget,
    documentTitle: string,
  ) => Promise<MobileWysiwygOutlineScrollResult>
}

type MobileOutlineBridgeExtension = {
  clone: () => MobileOutlineBridgeExtension
  configureCSS: (css: string) => MobileOutlineBridgeExtension
  configureExtension: (config: unknown) => MobileOutlineBridgeExtension
  configureTiptapExtensionsOnRunTime: () => AnyExtension[]
  extendEditorInstance: (sendBridgeMessage: (message: OutlineBridgeMessage) => void) => MobileWysiwygOutlineEditorBridge
  extendExtension: (config: unknown) => MobileOutlineBridgeExtension
  extendCSS: string
  name: string
  onBridgeMessage: (
    editor: Editor,
    message: OutlineBridgeMessage,
    sendMessageBack: (message: OutlineBridgeMessage) => void,
  ) => boolean
  onEditorMessage: (message: OutlineBridgeMessage) => boolean
  tiptapExtension: AnyExtension
}

const MobileOutlineExtension = Extension.create({ name: 'mobileOutline' })
const pendingOutlineScrolls = new Map<string, PendingOutlineScroll>()
const outlineScrollTimeoutMs = 1500
const editorTopInset = 16
let nextOutlineMessageId = 0

export const MobileWysiwygOutlineBridge = mobileOutlineBridge()

export function mobileWysiwygOutlineHeadingIndex({
  documentTitle,
  headings,
  target,
}: {
  documentTitle: string
  headings: OutlineHeading[]
  target: MobileTableOfContentsTarget
}): number | null {
  if (target.id === 'toc-title') return documentTitleHeadingIndex(headings, documentTitle)
  return indexedOutlineHeading({ documentTitle, headings, target })
}

function documentTitleHeadingIndex(headings: OutlineHeading[], documentTitle: string): number | null {
  const heading = headings[0]
  return heading?.level === 1 && sameTitle(heading.title, documentTitle) ? 0 : null
}

function indexedOutlineHeading({
  documentTitle,
  headings,
  target,
}: {
  documentTitle: string
  headings: OutlineHeading[]
  target: MobileTableOfContentsTarget
}): number | null {
  const targetIndex = outlineTargetIndex(target.id)
  if (targetIndex === null) return null
  const titleOffset = documentTitleHeadingIndex(headings, documentTitle) === 0 ? 1 : 0
  const headingIndex = targetIndex + titleOffset
  return headingMatchesTarget(headings[headingIndex], target) ? headingIndex : null
}

const outlineTargetIndex = (targetId: string): number | null => {
  const index = Number.parseInt(targetId.replace('toc-heading-', ''), 10)
  return Number.isInteger(index) && index >= 0 ? index : null
}

function headingMatchesTarget(heading: OutlineHeading | undefined, target: MobileTableOfContentsTarget): boolean {
  return heading?.level === target.level && sameTitle(heading.title, target.title)
}

function mobileOutlineBridge(): MobileOutlineBridgeExtension {
  return {
    clone: mobileOutlineBridge,
    configureCSS: () => mobileOutlineBridge(),
    configureExtension: () => mobileOutlineBridge(),
    configureTiptapExtensionsOnRunTime: () => [MobileOutlineExtension],
    extendCSS: '',
    extendEditorInstance: (sendBridgeMessage) => ({
      scrollToMobileOutlineTarget: (target, documentTitle) =>
        requestOutlineScroll(sendBridgeMessage, target, documentTitle),
    }),
    extendExtension: () => mobileOutlineBridge(),
    name: MobileOutlineExtension.name,
    onBridgeMessage: (editor, message, sendMessageBack) => {
      if (message.type !== 'scroll-mobile-outline-target') return false
      scrollEditorToOutlineTarget(editor, message, sendMessageBack)
      return true
    },
    onEditorMessage: (message) => {
      if (message.type !== 'mobile-outline-target-scrolled') return false
      resolveOutlineScroll(message.payload)
      return true
    },
    tiptapExtension: MobileOutlineExtension,
  }
}

function scrollEditorToOutlineTarget(
  editor: Editor,
  message: OutlineScrollRequest,
  sendMessageBack: (message: OutlineBridgeMessage) => void,
): void {
  const scrollContainer = editor.view.dom.parentElement
  const headings = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3'))
  const headingIndex = mobileWysiwygOutlineHeadingIndex({
    documentTitle: message.payload.documentTitle,
    headings: headings.map(domHeading),
    target: message.payload.target,
  })
  const heading = headingIndex === null ? null : headings[headingIndex]
  const beforeY = scrollContainer?.scrollTop ?? 0
  const expectedY = heading ? Math.max(0, heading.offsetTop - editorTopInset) : beforeY
  if (scrollContainer && heading) scrollContainer.scrollTop = expectedY

  setTimeout(
    () =>
      sendMessageBack({
        payload: {
          afterY: scrollContainer?.scrollTop ?? beforeY,
          beforeY,
          expectedY,
          found: Boolean(scrollContainer && heading),
          messageId: message.payload.messageId,
          targetId: message.payload.target.id,
        },
        type: 'mobile-outline-target-scrolled',
      }),
    50,
  )
}

function requestOutlineScroll(
  sendBridgeMessage: (message: OutlineBridgeMessage) => void,
  target: MobileTableOfContentsTarget,
  documentTitle: string,
): Promise<MobileWysiwygOutlineScrollResult> {
  const messageId = nextOutlineScrollMessageId()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingOutlineScrolls.delete(messageId)
      resolve(emptyOutlineScrollResult(target.id))
    }, outlineScrollTimeoutMs)
    pendingOutlineScrolls.set(messageId, { resolve, timeout })
    sendBridgeMessage({
      payload: { documentTitle, messageId, target },
      type: 'scroll-mobile-outline-target',
    })
  })
}

function nextOutlineScrollMessageId(): string {
  nextOutlineMessageId += 1
  return `mobile-outline-${nextOutlineMessageId}`
}

function resolveOutlineScroll(payload: MobileWysiwygOutlineScrollResult & { messageId: string }): void {
  const pending = pendingOutlineScrolls.get(payload.messageId)
  if (!pending) return
  pendingOutlineScrolls.delete(payload.messageId)
  clearTimeout(pending.timeout)
  pending.resolve(payload)
}

function emptyOutlineScrollResult(targetId: string): MobileWysiwygOutlineScrollResult {
  return { afterY: 0, beforeY: 0, expectedY: 0, found: false, targetId }
}

function domHeading(element: HTMLElement): OutlineHeading {
  return {
    level: Number.parseInt(element.tagName.slice(1), 10),
    title: element.textContent ?? '',
  }
}

function sameTitle(left: string, right: string): boolean {
  return normalizedTitle(left) === normalizedTitle(right)
}

function normalizedTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}
