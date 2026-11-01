import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const result = await build({
  absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)),
  entryPoints: [fileURLToPath(new URL('../src/components/workspace/MobileDiagramRenderer.web.ts', import.meta.url))],
  bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, outfile: 'diagram.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
})
const script = (result.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? '').replaceAll('</script', '<\\/script')
if (!script) throw new Error('Missing diagram renderer output')
const hash = createHash('sha256').update(script).digest('base64')
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Memoria</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:">
<style>body{margin:0;padding:0}#dmermaid{position:absolute;left:-10000px;top:0}</style></head>
<body><script>${script}</script></body></html>`
await writeFile(new URL('../assets/diagram-renderer.html', import.meta.url), html)
