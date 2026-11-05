import { expect, it } from 'vitest'
import { mobileFilePreviewSource } from './mobileFilePreviewSource'

it('uses the desktop image rules and encodes a vault-local source without reading binary data', () => {
  expect(mobileFilePreviewSource({ id: 'folder/Photo #1.PNG', fileKind: 'binary' }, 'file:///vault/')).toEqual({
    kind: 'image', uri: 'file:///vault/folder/Photo%20%231.PNG',
  })
})

it('does not trust a note title or treat Markdown containing an image as an image file', () => {
  expect(mobileFilePreviewSource({ id: 'note.md', fileKind: 'markdown' }, 'file:///vault/')).toBeNull()
  expect(mobileFilePreviewSource({ id: 'no-extension', fileKind: 'binary' }, 'file:///vault/')).toBeNull()
})

it('rejects paths outside the active local vault and unsupported files', () => {
  for (const id of ['../private.png', 'folder/../../private.png', 'file:///private.png', 'https://example.com/a.png', 'file.zip']) {
    expect(mobileFilePreviewSource({ id, fileKind: 'binary' }, 'file:///vault/')).toBeNull()
  }
  for (const root of [null, undefined, '', 'https://example.com/', 'file://host/']) {
    expect(mobileFilePreviewSource({ id: 'image.png', fileKind: 'binary' }, root)).toBeNull()
  }
})

it('retains the PDF kind for the native renderer and prefers the actual file path', () => {
  expect(mobileFilePreviewSource({ id: 'stable-id', path: 'docs/Manual.pdf', fileKind: 'binary' }, 'file:///vault')).toEqual({
    kind: 'pdf', uri: 'file:///vault/docs/Manual.pdf',
  })
})
