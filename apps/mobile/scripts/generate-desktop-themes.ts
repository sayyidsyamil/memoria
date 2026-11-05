import { readFile, writeFile } from 'node:fs/promises'
import { parseDesktopThemes } from '../src/ui/theme/parseDesktopTheme.ts'

const source = new URL('../../../src/index.css', import.meta.url)
const target = new URL('../src/ui/theme/desktopThemes.generated.json', import.meta.url)
const themes = parseDesktopThemes(await readFile(source, 'utf8'))
await writeFile(target, `${JSON.stringify(themes, null, 2)}\n`)
console.log('Updated mobile light/dark palettes from desktop src/index.css')
