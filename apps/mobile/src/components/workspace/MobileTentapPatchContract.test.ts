import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patchPath = fileURLToPath(
  new URL('../../../../../patches/@10play__tentap-editor@1.0.1.patch', import.meta.url),
)
const patch = readFileSync(patchPath, 'utf8')

describe('TenTap iOS WebView patch', () => {
  it('returns a supported value from runtime JavaScript injections', () => {
    const richTextPatch = filePatch('src/RichText/RichText.tsx')

    expect(richTextPatch).toContain(`if(doc) doc.style.paddingBottom = '\${height}px';`)
    expect(richTextPatch).toContain('+          true;')
  })

  it('returns a supported value from stylesheet and bootstrap injections', () => {
    const utilitiesPatch = filePatch('src/RichText/utils.ts')

    expect(utilitiesPatch).toContain('styleElement.innerHTML = cssContent;\n+    true;')
    expect(utilitiesPatch).toContain(`window.platform = "\${Platform.OS}";\n+    true;`)
  })

  it('does not reload a bundled custom editor after its first iOS load', () => {
    const richTextPatch = filePatch('src/RichText/RichText.tsx')

    expect(richTextPatch).toContain(
      "+          if (Platform.OS === 'ios' && key === 'webview' && !editor.customSource) {",
    )
  })
})

function filePatch(path: string) {
  const start = patch.indexOf(`diff --git a/${path} b/${path}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = patch.indexOf('\ndiff --git ', start + 1)
  return patch.slice(start, next === -1 ? undefined : next)
}
