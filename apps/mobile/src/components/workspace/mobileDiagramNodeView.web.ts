import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { readMobileDiagramSource } from '../../workspace/mobileDiagramMarkdown'
import { MobileDiagramRendererClient } from './mobileDiagramRendererClient.web'

const clients = new WeakMap<Editor, MobileDiagramRendererClient>()

export function disposeMobileDiagramRenderer(editor: Editor) {
  clients.get(editor)?.dispose()
  clients.delete(editor)
}

export class MobileDiagramNodeView implements NodeView {
  readonly dom = document.createElement('div')
  private readonly fallback = document.createElement('pre')
  private readonly image = document.createElement('img')
  private readonly theme = new MutationObserver(() => { if (this.visible) this.render() })
  private readonly visibility: IntersectionObserver | null
  private source: string
  private visible = false
  private renderKey = ''
  private version = 0
  private imageUrl: string | null = null

  constructor(node: ProseMirrorNode, private readonly editor: Editor) {
    this.source = String(node.attrs.source)
    this.dom.contentEditable = 'false'
    this.dom.dataset.mobileDiagramKind = readMobileDiagramSource(this.source)?.kind
    Object.assign(this.dom.style, { margin: '1em 0', maxWidth: '100%', overflow: 'hidden' })
    Object.assign(this.image.style, { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto' })
    this.image.hidden = true
    this.image.style.display = 'none'
    Object.assign(this.fallback.style, { maxHeight: '16em', overflow: 'auto', whiteSpace: 'pre-wrap' })
    this.fallback.textContent = this.source
    this.dom.append(this.image, this.fallback)
    this.theme.observe(document.head, { childList: true, subtree: true, characterData: true })
    this.visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      this.visible = true
      this.visibility?.disconnect()
      this.render()
    }, { rootMargin: '200px' })
    this.visibility?.observe(this.dom)
    if (!this.visibility) { this.visible = true; queueMicrotask(() => this.render()) }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== 'mobileDiagram') return false
    this.source = String(node.attrs.source)
    this.fallback.textContent = this.source
    if (this.visible) this.render()
    return true
  }

  ignoreMutation() { return true }
  destroy() {
    this.version += 1
    this.visibility?.disconnect()
    this.theme.disconnect()
    this.releaseImage()
  }

  private render() {
    const diagram = readMobileDiagramSource(this.source)
    if (diagram?.kind !== 'mermaid') return
    const dark = diagramSurfaceIsDark()
    const key = `${dark}:${this.source}`
    if (key === this.renderKey) return
    this.renderKey = key
    const version = ++this.version
    this.releaseImage()
    this.fallback.hidden = false
    const client = clients.get(this.editor) ?? new MobileDiagramRendererClient()
    clients.set(this.editor, client)
    void client.render({ kind: diagram.kind, content: diagram.content, dark }).then(svg => {
      if (version !== this.version) return
      this.imageUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      this.image.src = this.imageUrl
      this.image.alt = diagram.kind
      this.image.onload = () => {
        if (version !== this.version) return
        this.image.hidden = false
        this.image.style.display = 'block'
        this.fallback.hidden = true
      }
    }).catch(() => undefined)
  }

  private releaseImage() {
    this.image.onload = null
    this.image.hidden = true
    this.image.style.display = 'none'
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl)
    this.imageUrl = null
  }
}

function diagramSurfaceIsDark(): boolean {
  const channels = getComputedStyle(document.body).backgroundColor.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number)
  return !!channels && channels.length === 3 && channels.reduce((sum, channel) => sum + channel, 0) < 384
}
