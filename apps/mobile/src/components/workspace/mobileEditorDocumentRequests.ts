type ReadKind = 'get-json' | 'get-html' | 'get-text'
export type MobileEditorDocumentReadMessage = { type: ReadKind; payload: { messageId: string } }
type SendMessage = (message: MobileEditorDocumentReadMessage) => void
type PendingRead = {
  replyType: string
  resolve: (content: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const replyTypes = { 'get-json': 'send-json-back', 'get-html': 'send-html-back', 'get-text': 'send-text-back' }
let nextReadId = 0

/** Uses TenTap's existing wire protocol without its unbounded callback table. */
export function createMobileEditorDocumentRequests() {
  return new MobileEditorDocumentRequests()
}

class MobileEditorDocumentRequests {
  private readonly pending = new Map<string, PendingRead>()
  private active = true

  readJSON(send: SendMessage) { return this.request('get-json', send).then(requireDocument) }
  readHTML(send: SendMessage) { return this.request('get-html', send).then(requireText) }
  readText(send: SendMessage) { return this.request('get-text', send).then(requireText) }
  pendingCount() { return this.pending.size }
  activate() { this.active = true }
  retire() { this.active = false }

  dispose() {
    this.active = false
    for (const id of this.pending.keys()) this.take(id)?.reject(new Error('editorDisposed'))
  }

  receive(message: unknown) {
    const response = documentResponse(message)
    if (!response) return false
    const read = this.pending.get(response.messageId)
    if (!read || read.replyType !== response.type) return false
    this.take(response.messageId)?.resolve(response.content)
    return true
  }

  private request(type: ReadKind, send: SendMessage) {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.active) { reject(new Error('editorDisposed')); return }
      if (this.pending.size >= 32) { reject(new Error('editorReadLimitReached')); return }
      const messageId = `memoria-document-${++nextReadId}`
      const timer = setTimeout(() => this.take(messageId)?.reject(new Error('editorReadTimedOut')), 10_000)
      this.pending.set(messageId, { resolve, reject, timer, replyType: replyTypes[type] })
      try { send({ type, payload: { messageId } }) }
      catch (error) { this.take(messageId)?.reject(error) }
    })
  }

  private take(id: string) {
    const read = this.pending.get(id)
    if (read) { this.pending.delete(id); clearTimeout(read.timer) }
    return read
  }
}

function documentResponse(message: unknown) {
  if (!isRecord(message) || !isRecord(message.payload)) return null
  const { payload } = message
  return typeof payload.messageId === 'string'
    ? { type: message.type, messageId: payload.messageId, content: payload.content } : null
}

function requireDocument(value: unknown) {
  if (!isRecord(value) || value.type !== 'doc') throw new Error('invalidEditorDocument')
  return value
}

function requireText(value: unknown) {
  if (typeof value !== 'string') throw new Error('invalidEditorText')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
