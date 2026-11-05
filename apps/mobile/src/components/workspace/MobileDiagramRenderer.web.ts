import mermaid from 'mermaid'
import { isDiagramRequest, type DiagramRequest, type DiagramResponse } from './mobileDiagramProtocol'

let pending = Promise.resolve()
const parentOrigin = document.referrer ? new URL(document.referrer).origin : 'null'
let connected = false

window.addEventListener('message', event => {
  if (event.origin !== parentOrigin) { return }
  if (connected || event.source !== window.parent || !isConnectionRequest(event)) return
  connected = true
  connectPort(event.ports[0])
})

function isConnectionRequest(event: MessageEvent): boolean {
  return event.data?.type === 'memoria-diagram-connect' && event.ports.length === 1
}

function connectPort(port: MessagePort) {
  port.onmessage = (message: MessageEvent<unknown>) => {
    if (!isDiagramRequest(message.data)) return
    const request = message.data
    pending = pending.then(() => renderRequest(request, port)).catch(() => undefined)
  }
  port.postMessage({ type: 'memoria-diagram-ready' })
}

async function renderRequest(request: DiagramRequest, port: MessagePort) {
  let response: DiagramResponse
  try {
    if (request.kind !== 'mermaid') throw new Error('Whiteboard preview unavailable')
    const svg = await renderMermaid(request)
    response = { type: 'memoria-diagram-result', id: request.id, svg }
  } catch {
    response = { type: 'memoria-diagram-result', id: request.id, failed: true }
  }
  port.postMessage(response)
}

async function renderMermaid(request: DiagramRequest): Promise<string> {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    theme: request.dark ? 'dark' : 'default', fontFamily: 'system-ui, sans-serif',
    flowchart: { htmlLabels: false } })
  const result = await mermaid.render(`mobile-diagram-${request.id}`, request.content)
  return result.svg
}

