import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appShellFiles, appShellPreload, appShellPreloadTags } from './appShellPreload.ts'

function chunk(fileName: string, imports: string[] = [], moduleIds: string[] = []) {
  return { type: 'chunk' as const, fileName, imports, moduleIds }
}

const BUNDLE = {
  'assets/main.js': chunk('assets/main.js', ['assets/vendor.js'], ['/repo/index.html']),
  'assets/App.js': chunk('assets/App.js', ['assets/vendor.js', 'assets/input.js'], ['/repo/src/App.css', '/repo/src/App.tsx']),
  'assets/input.js': chunk('assets/input.js', ['assets/vendor.js']),
  'assets/vendor.js': chunk('assets/vendor.js'),
  'assets/Editor.js': chunk('assets/Editor.js', ['assets/input.js'], ['/repo/src/components/Editor.tsx']),
  'assets/App.css': { type: 'asset' as const, fileName: 'assets/App.css' },
}

describe('app shell module preload (TOL-206)', () => {
  it('lists the app shell chunk and its static imports once each, not the editor', () => {
    assert.deepEqual(appShellFiles(BUNDLE), ['assets/App.js', 'assets/vendor.js', 'assets/input.js'])
  })

  it('lists nothing when the bundle has no app shell', () => {
    assert.deepEqual(appShellFiles({ 'assets/main.js': chunk('assets/main.js') }), [])
  })

  it('turns the files into module preload links in the head', () => {
    assert.deepEqual(appShellPreloadTags(['assets/App.js']), [
      { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/App.js' }, injectTo: 'head' },
    ])
  })

  it('adds the links to the shell page of a build only', () => {
    const { handler } = appShellPreload().transformIndexHtml as { handler: (html: string, context: object) => unknown }

    const shell = handler('<html></html>', { filename: '/repo/index.html', bundle: BUNDLE }) as { tags: unknown[] }
    assert.equal(shell.tags.length, 3)
    assert.equal(handler('<html></html>', { filename: '/repo/apps/web/collab.html', bundle: BUNDLE }), '<html></html>')
    assert.equal(handler('<html></html>', { filename: '/repo/index.html' }), '<html></html>')
  })

  it('leaves out what the page already loads', () => {
    const { handler } = appShellPreload().transformIndexHtml as { handler: (html: string, context: object) => unknown }
    const html = '<script type="module" src="/assets/main.js"></script><link rel="modulepreload" href="/assets/vendor.js">'

    const { tags } = handler(html, { filename: '/repo/index.html', bundle: BUNDLE }) as { tags: { attrs: { href: string } }[] }
    assert.deepEqual(tags.map((tag) => tag.attrs.href), ['/assets/App.js', '/assets/input.js'])
  })
})
