import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildVersion, SERVICE_WORKER_FILE, shellPrecacheFiles, memoriaServiceWorker } from './serviceWorkerPlugin.ts'

function chunk(fileName: string, fields: Record<string, unknown> = {}) {
  return { type: 'chunk', fileName, isEntry: false, facadeModuleId: null, imports: [], dynamicImports: [], ...fields }
}

function bundle() {
  return {
    'main.js': chunk('main.js', {
      isEntry: true,
      facadeModuleId: '/repo/index.html',
      imports: ['shared.js'],
      dynamicImports: ['App.js'],
      viteMetadata: { importedCss: new Set(['main.css']) },
    }),
    'shared.js': chunk('shared.js', { imports: ['main.js'] }),
    'App.js': chunk('App.js', { imports: ['shared.js'], dynamicImports: ['Settings.js'] }),
    'Settings.js': chunk('Settings.js'),
    'collab.js': chunk('collab.js', { isEntry: true, facadeModuleId: '/repo/apps/web/collab.html' }),
    'logo.png': { type: 'asset', fileName: 'logo.png' },
  }
}

describe('service worker build plugin', () => {
  it('precaches the shell entry, its imports and the app chunk, but not later chunks', () => {
    assert.deepEqual(shellPrecacheFiles(bundle() as never), ['/App.js', '/main.css', '/main.js', '/shared.js'])
  })

  it('versions the worker by the files of the build', () => {
    const version = buildVersion(bundle() as never)
    assert.match(version, /^[0-9a-f]{16}$/)
    assert.equal(buildVersion(bundle() as never), version)
    assert.notEqual(buildVersion({ ...bundle(), 'extra.js': chunk('extra.js') } as never), version)
  })

  it('emits a self-contained worker that carries the version and precache list', async () => {
    const plugin = memoriaServiceWorker()
    assert.equal(plugin.apply, 'build')
    const emitted: { fileName: string; source: string }[] = []
    const generateBundle = plugin.generateBundle as (this: unknown, options: unknown, output: unknown) => Promise<void>
    await generateBundle.call({ emitFile: (file: { fileName: string; source: string }) => emitted.push(file) }, {}, bundle())

    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].fileName, SERVICE_WORKER_FILE)
    assert.ok(emitted[0].source.includes(buildVersion(bundle() as never)))
    assert.ok(emitted[0].source.includes('/shared.js'))
    assert.ok(!/\bimport\s*[({]/.test(emitted[0].source))
  })
})
