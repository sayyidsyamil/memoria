type MobileWysiwygContentMessage = {
  payload: { content: string }
  type: 'mobile-set-content-silently'
}
type MobileWysiwygContentEditor = {
  commands: {
    setContent: (content: string, options: { emitUpdate: false }) => unknown
  }
}

export function applyMobileWysiwygContentMessage(
  editor: MobileWysiwygContentEditor,
  message: unknown,
): boolean {
  const contentMessage = mobileWysiwygContentMessage(message)
  if (!contentMessage) return false

  editor.commands.setContent(contentMessage.payload.content, { emitUpdate: false })
  return true
}

function mobileWysiwygContentMessage(message: unknown): MobileWysiwygContentMessage | null {
  if (!isRecord(message) || message.type !== 'mobile-set-content-silently') return null
  if (!isRecord(message.payload) || typeof message.payload.content !== 'string') return null
  return {
    payload: { content: message.payload.content },
    type: 'mobile-set-content-silently',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
