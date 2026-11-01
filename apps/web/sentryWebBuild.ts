import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin, Rollup } from 'vite'

// TOL-232: error telemetry of the web build. The web bundle gets its own Sentry DSN from the
// build environment (unset = telemetry off) and a `memoria-web@<commit>` release. Source maps
// are generated hidden and written next to apps/web/dist, never into it, so the deploy can
// upload them to Sentry without serving them. See docs/web/telemetry.md.

/** Build environment names; the deploy pipeline sets them (docs/web/telemetry.md). */
export const WEB_SENTRY_DSN_ENV = 'MEMORIA_WEB_SENTRY_DSN'
export const WEB_RELEASE_ENV = 'MEMORIA_WEB_RELEASE'
export const SOURCEMAP_MANIFEST_FILE = 'manifest.json'
const RELEASE_PREFIX = 'memoria-web@'

type BuildEnv = Record<string, string | undefined>
type EnvName = string
type CommitSha = string
type ReleaseName = string
type DirectoryPath = string
type SourceMaps = Map<string, Rollup.OutputAsset['source']>

/** Where the maps of a build go, and the release they belong to. */
export interface SourceMapOutput {
  dir: DirectoryPath
  release: ReleaseName
}

export interface SourceMapEntry {
  file: string
  map: string
}

export interface SourceMapManifest {
  release: string
  files: SourceMapEntry[]
}

function envValue(env: BuildEnv, name: EnvName): string {
  return (env[name] ?? '').trim()
}

/** The checked-out commit of the build, or '' outside a git checkout. */
export function currentCommit(cwd: DirectoryPath): CommitSha {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export function webRelease(env: BuildEnv, commit: CommitSha): ReleaseName {
  const explicit = envValue(env, WEB_RELEASE_ENV)
  if (explicit) return explicit
  return commit ? `${RELEASE_PREFIX}${commit}` : ''
}

/**
 * Replaces the desktop telemetry variables in the web bundle: a DSN meant for the desktop app
 * never reaches the web build, and no DSN means the bundle does not send anything.
 */
export function webSentryDefine(env: BuildEnv, release: ReleaseName): Record<string, string> {
  return {
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(envValue(env, WEB_SENTRY_DSN_ENV)),
    'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(release),
  }
}

function isSourceMapAsset(output: Rollup.OutputAsset | Rollup.OutputChunk): output is Rollup.OutputAsset {
  return output.type === 'asset' && output.fileName.endsWith('.map')
}

function sourceMapsOf(bundle: Rollup.OutputBundle): SourceMaps {
  const maps: SourceMaps = new Map()
  for (const [fileName, output] of Object.entries(bundle)) {
    if (isSourceMapAsset(output)) maps.set(fileName, output.source)
  }
  return maps
}

function removeFromOutput(outDir: DirectoryPath, maps: SourceMaps): void {
  for (const fileName of maps.keys()) rmSync(join(outDir, fileName), { force: true })
}

function writeSourceMaps({ dir, release }: SourceMapOutput, maps: SourceMaps): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const files: SourceMapEntry[] = []
  for (const [map, source] of maps) {
    const target = join(dir, map)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
    files.push({ file: map.slice(0, -'.map'.length), map })
  }
  files.sort((a, b) => a.file.localeCompare(b.file))
  const manifest: SourceMapManifest = { release, files }
  writeFileSync(join(dir, SOURCEMAP_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Moves the hidden source maps out of the served output into `dir`, with a manifest naming the
 * release and the bundle file each map belongs to. It runs after the bundle is written because
 * Vite still rewrites chunks (and their maps) in its own late `generateBundle` hooks. The
 * served output keeps no `.map` file and, with `sourcemap: 'hidden'`, no `sourceMappingURL`.
 */
export function hiddenSourceMaps(output: SourceMapOutput): Plugin {
  return {
    name: 'memoria-web-hidden-sourcemaps',
    apply: 'build',
    writeBundle(options, bundle) {
      const maps = sourceMapsOf(bundle)
      writeSourceMaps(output, maps)
      if (options.dir) removeFromOutput(options.dir, maps)
    },
  }
}
