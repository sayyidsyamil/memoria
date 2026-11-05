import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core'
import {
  mobileDisplayMathSource,
  mobileInlineMathSource,
  renderMobileMathIntoElement,
} from './MobileWysiwygMathHtml'

const MATH_BLOCK_TYPE = 'mathBlock'
const MATH_INLINE_TYPE = 'mathInline'
const MATH_BRIDGE_NAME = MATH_INLINE_TYPE

type MathAttributes = {
  latex: string
}
type MathRenderKind = 'block' | 'inline'
type MathEditorInstance = {
  getMathBlockRenderProof: () => Promise<boolean>
  getMathInlineRenderProof: () => Promise<boolean>
}
type MathHtmlAttributes = Record<string, string>
type MathRenderSpec = HTMLElement | [string, MathHtmlAttributes, string]
type MathBridgeMessage = MathRenderProofRequest | MathRenderProofResponse
type MathRenderProofRequest = {
  payload: {
    kind: MathRenderKind
    messageId: string
  }
  type: 'get-math-render-proof'
}
type MathRenderProofResponse = {
  payload: {
    messageId: string
    rendered: boolean
  }
  type: 'send-math-render-proof'
}
type PendingMathRenderProof = {
  resolve: (rendered: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}
type MathNodeDefinition = {
  className: string
  displayMode: boolean
  group: 'block' | 'inline'
  inline: boolean
  name: typeof MATH_BLOCK_TYPE | typeof MATH_INLINE_TYPE
  parseTags: string[]
  source: (latex: string) => string
  tagName: 'div' | 'span'
}
type MobileMathBridgeExtension = {
  clone: () => MobileMathBridgeExtension
  config?: unknown
  configureCSS: (css: string) => MobileMathBridgeExtension
  configureExtension: (config: unknown) => MobileMathBridgeExtension
  configureTiptapExtensionsOnRunTime: (config: unknown, extendConfig: unknown) => (AnyExtension | undefined)[]
  extendExtension: (extendConfig: unknown) => MobileMathBridgeExtension
  extendConfig?: unknown
  extendCSS: string
  extendEditorInstance: (sendBridgeMessage: (message: MathBridgeMessage) => void) => MathEditorInstance
  name: string
  onBridgeMessage: (
    editor: unknown,
    message: MathBridgeMessage,
    sendMessageBack: (message: MathBridgeMessage) => void,
  ) => boolean
  onEditorMessage: (message: MathBridgeMessage) => boolean
  tiptapExtension: AnyExtension
}
type MobileMathBridgeOptions = {
  config?: unknown
  css?: string
  extendConfig?: unknown
}

const mathRenderProofs = new Map<string, PendingMathRenderProof>()
const mathRenderProofTimeoutMs = 1000
let mathRenderProofSequence = 0
const mathBridgeCss = `
  .math {
    color: inherit;
    max-width: 100%;
  }

  .math math {
    max-width: 100%;
  }

  .math.math--inline {
    display: inline-flex;
    vertical-align: baseline;
    white-space: nowrap;
  }

  .math.math--inline .katex,
  .math.math--inline math {
    display: inline-flex;
  }

  .math.math--display {
    align-items: center;
    display: flex;
    justify-content: center;
    margin: 18px 0;
    overflow-x: auto;
    white-space: normal;
  }

  .math.math--display .katex,
  .math.math--display math {
    display: block;
  }
`

const inlineMathDefinition = {
  className: 'math math--inline',
  displayMode: false,
  group: 'inline',
  inline: true,
  name: MATH_INLINE_TYPE,
  parseTags: [
    'span[data-type="mathInline"]',
    'span.math--inline[data-latex]',
  ],
  source: mobileInlineMathSource,
  tagName: 'span',
} as const satisfies MathNodeDefinition

const blockMathDefinition = {
  className: 'math math--display',
  displayMode: true,
  group: 'block',
  inline: false,
  name: MATH_BLOCK_TYPE,
  parseTags: [
    'div[data-type="mathBlock"]',
    'div.math--display[data-latex]',
  ],
  source: mobileDisplayMathSource,
  tagName: 'div',
} as const satisfies MathNodeDefinition

const MathInlineNode = mathNode(inlineMathDefinition)
const MathBlockNode = mathNode(blockMathDefinition)

export const MobileMathInlineBridge = mobileMathBridge()

function mathNode(definition: MathNodeDefinition): AnyExtension {
  return Node.create({
    name: definition.name,
    group: definition.group,
    inline: definition.inline,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        latex: {
          default: '',
          parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
          renderHTML: () => ({}),
        },
      }
    },

    parseHTML() {
      return definition.parseTags.map((tag) => ({ tag }))
    },

    renderHTML({ HTMLAttributes, node }) {
      const latex = mathLatex(node.attrs)
      const source = definition.source(latex)
      const attributes = mathHtmlAttributes(HTMLAttributes, {
        class: definition.className,
        'data-latex': latex,
        'data-type': definition.name,
        role: 'img',
        title: source,
      })

      return mathRenderSpec(definition, attributes, latex, source)
    },

    addNodeView() {
      return ({ node }) => {
        const latex = mathLatex(node.attrs)
        const source = definition.source(latex)
        return {
          dom: mathElement(definition, mathHtmlAttributes({}, {
            class: definition.className,
            'data-latex': latex,
            'data-type': definition.name,
            role: 'img',
            title: source,
          }), latex),
        }
      }
    },
  })
}

function mathLatex(attributes: Partial<MathAttributes>): string {
  return typeof attributes.latex === 'string' ? attributes.latex : ''
}

function mathHtmlAttributes(
  baseAttributes: Record<string, unknown>,
  overrides: MathHtmlAttributes,
): MathHtmlAttributes {
  return stringHtmlAttributes(mergeAttributes(baseAttributes, overrides) as Record<string, unknown>)
}

function stringHtmlAttributes(attributes: Record<string, unknown>): MathHtmlAttributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== null && value !== undefined && value !== false)
      .map(([name, value]) => [name, value === true ? '' : String(value)]),
  )
}

function mathRenderSpec(
  definition: MathNodeDefinition,
  attributes: MathHtmlAttributes,
  latex: string,
  source: string,
): MathRenderSpec {
  if (typeof document === 'undefined') return [definition.tagName, attributes, source]

  return mathElement(definition, attributes, latex)
}

function mathElement(
  definition: MathNodeDefinition,
  attributes: MathHtmlAttributes,
  latex: string,
): HTMLElement {
  const element = document.createElement(definition.tagName)
  applyHtmlAttributes(element, attributes)
  renderMobileMathIntoElement(latex, element, definition.displayMode)
  return element
}

function applyHtmlAttributes(element: HTMLElement, attributes: MathHtmlAttributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value)
  }
}

function hasRenderedMath(kind: MathRenderKind): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(mathRenderProofSelector(kind)) !== null
}

function mathRenderProofSelector(kind: MathRenderKind): string {
  return kind === 'inline'
    ? '.math.math--inline math'
    : '.math.math--display math'
}

function mobileMathBridge({
  config,
  css = mathBridgeCss,
  extendConfig,
}: MobileMathBridgeOptions = {}): MobileMathBridgeExtension {
  return {
    clone: () => mobileMathBridge({ config, css, extendConfig }),
    config,
    configureCSS: (nextCss) => mobileMathBridge({ config, css: nextCss, extendConfig }),
    configureExtension: (nextConfig) => mobileMathBridge({ config: nextConfig, css, extendConfig }),
    configureTiptapExtensionsOnRunTime: (runtimeConfig, runtimeExtendConfig) => (
      [
        configuredMathNode(MathInlineNode, runtimeConfig, runtimeExtendConfig),
        configuredMathNode(MathBlockNode, runtimeConfig, runtimeExtendConfig),
      ]
    ),
    extendExtension: (nextExtendConfig) => mobileMathBridge({ config, css, extendConfig: nextExtendConfig }),
    extendConfig,
    extendCSS: css,
    extendEditorInstance: (sendBridgeMessage) => ({
      getMathBlockRenderProof: () => requestMathRenderProof(sendBridgeMessage, 'block'),
      getMathInlineRenderProof: () => requestMathRenderProof(sendBridgeMessage, 'inline'),
    }),
    name: MATH_BRIDGE_NAME,
    onBridgeMessage: (_editor, message, sendMessageBack) => {
      if (message.type !== 'get-math-render-proof') return false

      sendMessageBack({
        payload: {
          messageId: message.payload.messageId,
          rendered: hasRenderedMath(message.payload.kind),
        },
        type: 'send-math-render-proof',
      })
      return true
    },
    onEditorMessage: (message) => {
      if (message.type !== 'send-math-render-proof') return false

      resolveMathRenderProof(message.payload.messageId, message.payload.rendered)
      return true
    },
    tiptapExtension: MathInlineNode,
  }
}

function configuredMathNode(extension: AnyExtension, config: unknown, extendConfig: unknown): AnyExtension {
  const configuredNode = config ? extension.configure(config) : extension
  return extendConfig ? configuredNode.extend(extendConfig) : configuredNode
}

function requestMathRenderProof(
  sendBridgeMessage: (message: MathBridgeMessage) => void,
  kind: MathRenderKind,
): Promise<boolean> {
  const messageId = String(++mathRenderProofSequence)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      mathRenderProofs.delete(messageId)
      resolve(false)
    }, mathRenderProofTimeoutMs)
    mathRenderProofs.set(messageId, { resolve, timeout })
    sendBridgeMessage({
      payload: { kind, messageId },
      type: 'get-math-render-proof',
    })
  })
}

function resolveMathRenderProof(messageId: string, rendered: boolean): void {
  const pendingProof = mathRenderProofs.get(messageId)
  if (!pendingProof) return

  mathRenderProofs.delete(messageId)
  clearTimeout(pendingProof.timeout)
  pendingProof.resolve(rendered)
}
