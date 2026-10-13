import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const config = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  app: { security: { csp: Record<string, string>; devCsp: string } }
  build: { beforeBuildCommand: string }
}

const REMOTE_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|posthog\.com/

function directive(policy: string, name: string): string {
  return policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? ''
}

describe('self-contained web view (no contact at start-up)', () => {
  it('index.html does not load fonts or anything else from a remote host', () => {
    const html = read('index.html')
    expect(html).not.toMatch(REMOTE_HOSTS)
    expect(html).not.toMatch(/<link[^>]+(href|src)="https?:\/\//)
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//)
  })

  it('bundles the fonts instead', () => {
    const fonts = read('src/fonts.ts')
    expect(fonts).toContain('@fontsource/inter/')
    expect(fonts).toContain('@fontsource/ibm-plex-mono/')
    expect(fonts).toContain('@fontsource/jetbrains-mono/')
  })

  it('the release CSP names no font or analytics host', () => {
    expect(JSON.stringify(config.app.security.csp)).not.toMatch(REMOTE_HOSTS)
  })

  it('the release CSP lets the web view connect only to itself, IPC and local sockets', () => {
    const connect = config.app.security.csp['connect-src'].split(/\s+/)
    expect(connect).not.toContain('https:')
    expect(connect).not.toContain('http:')
    expect(connect).not.toContain('*')
    for (const source of connect) {
      expect(source).toMatch(/^('self'|ipc:|http:\/\/ipc\.localhost|data:|ws:\/\/(localhost|127\.0\.0\.1):971[01])$/)
    }
  })

  it('the dev CSP has no remote host and no open https connect-src', () => {
    const { devCsp } = config.app.security
    expect(devCsp).not.toMatch(REMOTE_HOSTS)
    expect(directive(devCsp, 'connect-src').split(/\s+/)).not.toContain('https:')
  })

  it('the release build command only runs scripts that exist', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
    for (const match of config.build.beforeBuildCommand.matchAll(/pnpm (\S+)/g)) {
      expect(Object.keys(scripts)).toContain(match[1])
    }
  })
})
