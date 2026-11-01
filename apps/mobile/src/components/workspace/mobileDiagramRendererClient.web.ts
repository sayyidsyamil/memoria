import type { MobileDiagramKind } from '../../workspace/mobileDiagramMarkdown'
import { isDiagramResponse, type DiagramRequest } from './mobileDiagramProtocol'

type RenderInput = { kind: MobileDiagramKind; content: string; dark: boolean }
type PendingRender = {
  request: DiagramRequest
  resolve: (svg: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class MobileDiagramRendererClient {
  private readonly frame = document.createElement('iframe')
  private readonly pending = new Map<number, PendingRender>()
  private ready = false
  private disposed = false
  private nextId = 0
  private port: MessagePort | null = null

  constructor() {
    this.frame.src = new URL('diagram-renderer.html', document.baseURI).href
    this.frame.setAttribute('sandbox', 'allow-scripts')
    this.frame.setAttribute('aria-hidden', 'true')
    this.frame.tabIndex = -1
    Object.assign(this.frame.style, { position: 'fixed', left: '-20000px', top: '0', width: '1200px', height: '800px', border: '0', pointerEvents: 'none' })
    this.frame.onload = () => this.connect()
    document.body.append(this.frame)
  }

  render(input: RenderInput): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('Diagram renderer disposed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, 'Diagram renderer unavailable'), 30_000)
      const request: DiagramRequest = { type: 'memoria-diagram-render', id, ...input }
      this.pending.set(id, { request, resolve, reject, timer })
      if (this.ready) this.send(request)
    })
  }

  dispose() {
    this.disposed = true
    this.frame.onload = null
    this.port?.close()
    for (const id of this.pending.keys()) this.fail(id, 'Diagram renderer disposed')
    this.frame.remove()
  }

  private readonly receive = (event: MessageEvent<unknown>) => {
    if (isReady(event.data)) { this.start(); return }
    if (!isDiagramResponse(event.data)) return
    const result = event.data
    if (result.failed || !result.svg) { this.fail(result.id, 'Diagram preview unavailable'); return }
    const pending = this.take(result.id)
    pending?.resolve(result.svg)
  }

  private connect() {
    const channel = new MessageChannel()
    this.port?.close()
    this.port = channel.port1
    channel.port1.onmessage = this.receive
    // Only the port is transferred to this exact opaque-origin frame; no note data
    // travels over window messaging. Both endpoints use the private port afterward.
    this.frame.contentWindow?.postMessage({ type: 'memoria-diagram-connect' }, {
      targetOrigin: '*', transfer: [channel.port2],
    })
  }

  private start() {
    if (this.ready) return
    this.ready = true
    for (const pending of this.pending.values()) this.send(pending.request)
  }

  private send(request: DiagramRequest) { this.port?.postMessage(request) }
  private take(id: number) {
    const pending = this.pending.get(id)
    if (pending) clearTimeout(pending.timer)
    this.pending.delete(id)
    return pending
  }
  private fail(id: number, message: string) { this.take(id)?.reject(new Error(message)) }
}

function isReady(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'memoria-diagram-ready'
}
