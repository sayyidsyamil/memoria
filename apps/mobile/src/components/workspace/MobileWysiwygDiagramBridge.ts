import { Node, type AnyExtension } from '@tiptap/core'
import { readMobileDiagramSource } from '../../workspace/mobileDiagramMarkdown'

const DiagramNode = Node.create({
  name: 'mobileDiagram',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: {
    default: '',
    parseHTML: (element: HTMLElement) => decodeSource(element),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-mobile-diagram-source': encodeURIComponent(String(attributes.source ?? '')),
    }),
  } }),
  parseHTML: () => [{
    tag: 'div[data-mobile-diagram-kind]',
    getAttrs: (element: HTMLElement) => readMobileDiagramSource(decodeSource(element)) ? {} : false,
  }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', {
    ...HTMLAttributes,
    'data-mobile-diagram-kind': readMobileDiagramSource(String(node.attrs.source))?.kind,
  }, ['pre', {}, String(node.attrs.source)]],
})

function decodeSource(element: HTMLElement): string {
  try { return decodeURIComponent(element.getAttribute('data-mobile-diagram-source') ?? '') }
  catch { return '' }
}

type DiagramBridge = {
  clone: () => DiagramBridge
  config?: unknown
  configureCSS: (css: string) => DiagramBridge
  configureExtension: (config: unknown) => DiagramBridge
  configureTiptapExtensionsOnRunTime: (config: unknown, extend: unknown) => AnyExtension[]
  extendExtension: (extend: unknown) => DiagramBridge
  extendConfig?: unknown
  extendCSS: string
  name: string
  tiptapExtension: AnyExtension
}
type BridgeOptions = { config?: unknown; css?: string; extend?: unknown }

export const MobileDiagramBridge = diagramBridge()

function diagramBridge({ config, css = '', extend }: BridgeOptions = {}): DiagramBridge {
  return {
    clone: () => diagramBridge({ config, css, extend }),
    config,
    configureCSS: next => diagramBridge({ config, css: next, extend }),
    configureExtension: next => diagramBridge({ config: next, css, extend }),
    configureTiptapExtensionsOnRunTime: (nextConfig, nextExtend) => [configuredNode(nextConfig ?? config, nextExtend ?? extend)],
    extendExtension: next => diagramBridge({ config, css, extend: next }),
    extendConfig: extend,
    extendCSS: css,
    name: DiagramNode.name,
    tiptapExtension: DiagramNode,
  }
}

function configuredNode(config: unknown, extend: unknown): AnyExtension {
  const node = config ? DiagramNode.configure(config) : DiagramNode
  return extend ? node.extend(extend) : node
}
