import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isApiRequestPath,
  webPreviewAllowedHosts,
  webPreviewHost,
  webPreviewPort,
  webPreviewProxy,
} from './previewOptions.ts'

describe('web preview options', () => {
  it('binds to loopback unless a host is requested', () => {
    assert.equal(webPreviewHost({}), '127.0.0.1')
    assert.equal(webPreviewHost({ MEMORIA_WEB_HOST: '   ' }), '127.0.0.1')
    assert.equal(webPreviewHost({ MEMORIA_WEB_HOST: ' 0.0.0.0 ' }), '0.0.0.0')
  })

  it('falls back to the default port for missing or invalid values', () => {
    assert.equal(webPreviewPort({}), 4173)
    assert.equal(webPreviewPort({ MEMORIA_WEB_PORT: '8080' }), 8080)
    for (const invalid of ['abc', '0', '-1', '80.5', '70000']) {
      assert.equal(webPreviewPort({ MEMORIA_WEB_PORT: invalid }), 4173, invalid)
    }
  })

  it('parses a comma-separated allowed-host list', () => {
    assert.deepEqual(webPreviewAllowedHosts({}), [])
    assert.deepEqual(
      webPreviewAllowedHosts({ MEMORIA_WEB_ALLOWED_HOSTS: ' box.tailnet.ts.net, ,ipad.local ' }),
      ['box.tailnet.ts.net', 'ipad.local'],
    )
  })

  it('treats only /api paths as API requests', () => {
    for (const url of ['/api', '/api/vault/ping', '/api/vault/list?path=x']) {
      assert.equal(isApiRequestPath(url), true, url)
    }
    for (const url of [undefined, '/', '/assets/index.js', '/apiary', '/notes/api/x']) {
      assert.equal(isApiRequestPath(url), false, String(url))
    }
  })

  it('proxies the remote protocol, websockets included, only to an http(s) origin', () => {
    assert.deepEqual(webPreviewProxy({ MEMORIA_REMOTE_URL: ' http://127.0.0.1:8787 ' }), {
      '/v1': { target: 'http://127.0.0.1:8787', ws: true },
    })
    for (const invalid of [undefined, '', 'ftp://host', 'http://host/path', 'javascript:alert(1)', 'http://a b']) {
      assert.equal(webPreviewProxy({ MEMORIA_REMOTE_URL: invalid }), undefined, String(invalid))
    }
  })
})
