import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { Rollup } from 'vite'
import {
  currentCommit,
  hiddenSourceMaps,
  SOURCEMAP_MANIFEST_FILE,
  webRelease,
  webSentryDefine,
} from './sentryWebBuild.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

type WriteBundle = (this: unknown, options: { dir?: string }, bundle: Rollup.OutputBundle) => void

/** Runs the plugin on a bundle already written to `outDir`, as Rollup does. */
function writeBundle(dir: string, release: string, outDir: string, bundle: Rollup.OutputBundle): void {
  for (const [fileName, output] of Object.entries(bundle)) {
    mkdirSync(join(outDir, 'assets'), { recursive: true })
    writeFileSync(join(outDir, fileName), output.type === 'asset' ? output.source : output.code)
  }
  const hook = hiddenSourceMaps({ dir, release }).writeBundle as WriteBundle
  hook.call({}, { dir: outDir }, bundle)
}

function tempDir(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'memoria-maps-')), name)
}

function fakeBundle(): Rollup.OutputBundle {
  const asset = (fileName: string, source: string) => ({ type: 'asset', fileName, source })
  return {
    'assets/index-a.js': { type: 'chunk', fileName: 'assets/index-a.js', code: 'x' },
    'assets/index-a.js.map': asset('assets/index-a.js.map', '{"version":3}'),
    'assets/app-b.js.map': asset('assets/app-b.js.map', '{"version":3,"file":"b"}'),
    'assets/index-c.css': asset('assets/index-c.css', 'body{}'),
  } as unknown as Rollup.OutputBundle
}

describe('web Sentry build settings', () => {
  it('names the release after the commit unless one is given', () => {
    assert.equal(webRelease({}, COMMIT), `memoria-web@${COMMIT}`)
    assert.equal(webRelease({ MEMORIA_WEB_RELEASE: ' memoria-web@abc1234 ' }, COMMIT), 'memoria-web@abc1234')
    assert.equal(webRelease({}, ''), '')
  })

  it('bakes the web DSN in and leaves it empty when none is configured', () => {
    assert.deepEqual(webSentryDefine({}, ''), {
      'import.meta.env.VITE_SENTRY_DSN': '""',
      'import.meta.env.VITE_SENTRY_RELEASE': '""',
    })
    const define = webSentryDefine({ MEMORIA_WEB_SENTRY_DSN: ' http://key@127.0.0.1:9/1 ' }, 'memoria-web@abc1234')
    assert.equal(define['import.meta.env.VITE_SENTRY_DSN'], '"http://key@127.0.0.1:9/1"')
    assert.equal(define['import.meta.env.VITE_SENTRY_RELEASE'], '"memoria-web@abc1234"')
  })

  it('never takes the desktop DSN', () => {
    const define = webSentryDefine({ VITE_SENTRY_DSN: 'https://desktop@o1.ingest.sentry.io/2' }, '')
    assert.equal(define['import.meta.env.VITE_SENTRY_DSN'], '""')
  })

  it('reads the checked-out commit, or nothing outside a checkout', () => {
    assert.match(currentCommit(process.cwd()), /^[0-9a-f]{40}$/)
    assert.equal(currentCommit(mkdtempSync(join(tmpdir(), 'memoria-no-git-'))), '')
  })
})

describe('hidden source maps plugin', () => {
  it('moves the maps out of the served output and writes a manifest', () => {
    const dir = tempDir('sourcemaps')
    const outDir = tempDir('dist')

    writeBundle(dir, 'memoria-web@abc1234', outDir, fakeBundle())

    assert.equal(existsSync(join(outDir, 'assets/index-a.js.map')), false)
    assert.equal(existsSync(join(outDir, 'assets/app-b.js.map')), false)
    assert.equal(existsSync(join(outDir, 'assets/index-a.js')), true)
    assert.equal(existsSync(join(outDir, 'assets/index-c.css')), true)
    assert.equal(readFileSync(join(dir, 'assets/app-b.js.map'), 'utf8'), '{"version":3,"file":"b"}')
    assert.deepEqual(JSON.parse(readFileSync(join(dir, SOURCEMAP_MANIFEST_FILE), 'utf8')), {
      release: 'memoria-web@abc1234',
      files: [
        { file: 'assets/app-b.js', map: 'assets/app-b.js.map' },
        { file: 'assets/index-a.js', map: 'assets/index-a.js.map' },
      ],
    })
  })

  it('replaces the maps of a previous build', () => {
    const dir = tempDir('sourcemaps')
    writeBundle(dir, 'memoria-web@abc1234', tempDir('dist'), fakeBundle())
    writeBundle(dir, 'memoria-web@def5678', tempDir('dist'), {})

    assert.equal(existsSync(join(dir, 'assets/app-b.js.map')), false)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, SOURCEMAP_MANIFEST_FILE), 'utf8')), {
      release: 'memoria-web@def5678',
      files: [],
    })
  })
})
