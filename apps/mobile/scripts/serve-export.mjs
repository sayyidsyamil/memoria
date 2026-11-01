#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const port = Number(process.argv[2] ?? process.env.PORT ?? '42131')
const root = resolve(process.argv[3] ?? process.env.MOBILE_QA_EXPORT_DIR ?? '/tmp/memoria-mobile-ui-web')

const contentTypes = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://127.0.0.1:${port}`).pathname)
  const requested = resolve(join(root, pathname))
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    return null
  }
  return requested
}

async function fileForRequest(url) {
  const requested = resolveRequestPath(url)
  if (!requested) {
    return null
  }

  try {
    const info = await stat(requested)
    if (info.isFile()) {
      return requested
    }
  } catch {
    // Expo web uses index.html as the fallback document.
  }

  return join(root, 'index.html')
}

const server = createServer(async (request, response) => {
  if (redirectToFixtureSource(request, response)) return

  const file = await fileForRequest(request.url ?? '/')
  if (!file) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const info = await stat(file)
    if (!info.isFile()) {
      throw new Error('Not a file')
    }
    response.writeHead(200, {
      'Content-Length': info.size,
      'Content-Type': contentTypes.get(extname(file)) ?? 'application/octet-stream',
    })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`)
})

function close() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

function redirectToFixtureSource(request, response) {
  if (request.method !== 'GET') return false

  const fixtureLocation = fixtureSourceLocation(request.url ?? '/', request.headers.accept)
  if (!fixtureLocation) return false

  response.writeHead(302, { Location: fixtureLocation })
  response.end()
  return true
}

function fixtureSourceLocation(requestUrl, acceptHeader = '') {
  if (!acceptHeader.includes('text/html')) return null

  const url = new URL(requestUrl, `http://127.0.0.1:${port}`)
  if (url.searchParams.has('source')) return null

  url.searchParams.set('source', 'fixture')
  return `${url.pathname}${url.search}${url.hash}`
}
