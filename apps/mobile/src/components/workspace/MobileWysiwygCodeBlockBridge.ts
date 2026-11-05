import type { AnyExtension } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'

const codeBlockCss = `
  pre {
    white-space: pre-wrap;
    word-break: break-word;
  }

  pre code {
    background: transparent;
    border-radius: 0;
    padding: 0;
  }
`

const CodeBlockNode = CodeBlock.configure({
  defaultLanguage: 'text',
  languageClassPrefix: 'language-',
})

type MobileCodeBlockBridgeExtension = {
  clone: () => MobileCodeBlockBridgeExtension
  config?: unknown
  configureCSS: (css: string) => MobileCodeBlockBridgeExtension
  configureExtension: (config: unknown) => MobileCodeBlockBridgeExtension
  configureTiptapExtensionsOnRunTime: (config: unknown, extendConfig: unknown) => (AnyExtension | undefined)[]
  extendExtension: (extendConfig: unknown) => MobileCodeBlockBridgeExtension
  extendConfig?: unknown
  extendCSS: string
  name: string
  tiptapExtension: AnyExtension
}

type MobileCodeBlockBridgeOptions = {
  config?: unknown
  css?: string
  extendConfig?: unknown
}

export const MobileCodeBlockBridge = mobileCodeBlockBridge()

function mobileCodeBlockBridge({
  config,
  css = codeBlockCss,
  extendConfig,
}: MobileCodeBlockBridgeOptions = {}): MobileCodeBlockBridgeExtension {
  return {
    clone: () => mobileCodeBlockBridge({ config, css, extendConfig }),
    config,
    configureCSS: (nextCss) => mobileCodeBlockBridge({ config, css: nextCss, extendConfig }),
    configureExtension: (nextConfig) => mobileCodeBlockBridge({ config: nextConfig, css, extendConfig }),
    configureTiptapExtensionsOnRunTime: (runtimeConfig, runtimeExtendConfig) => [
      configuredCodeBlockNode(CodeBlockNode, runtimeConfig, runtimeExtendConfig),
    ],
    extendExtension: (nextExtendConfig) => mobileCodeBlockBridge({ config, css, extendConfig: nextExtendConfig }),
    extendConfig,
    extendCSS: css,
    name: CodeBlockNode.name,
    tiptapExtension: CodeBlockNode,
  }
}

function configuredCodeBlockNode(extension: AnyExtension, config: unknown, extendConfig: unknown): AnyExtension {
  const configuredNode = config ? extension.configure(config) : extension
  return extendConfig ? configuredNode.extend(extendConfig) : configuredNode
}
