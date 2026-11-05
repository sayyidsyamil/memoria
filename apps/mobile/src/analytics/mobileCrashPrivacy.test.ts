import { expect, it } from 'vitest'
import { sanitizeMobileCrash } from './mobileCrashPrivacy'

it('keeps symbolication coordinates but removes note content, paths, identity and attachments', () => {
  const event = { event_id: 'event', timestamp: 12, message: 'Private note', user: { email: 'private@example.com' },
    request: { url: 'https://github.com/private/vault?token=secret' }, extra: { body: 'Private note' },
    breadcrumbs: [{ message: 'Private note' }], contexts: { device: { name: 'Personal iPad' } },
    tags: { path: '/Users/private/note.md' },
    exception: { values: [{ type: 'TypeError', value: 'Cannot read /Users/private/note.md', stacktrace: {
      frames: [{ filename: 'file:///private/app/main.jsbundle', function: 'saveNote', lineno: 42, colno: 9, vars: { note: 'private' }, context_line: 'Private note' }],
    } }] },
  }
  const clean = sanitizeMobileCrash(event)
  expect(clean?.exception?.values?.[0]).toMatchObject({ type: 'TypeError', value: 'Mobile application error',
    stacktrace: { frames: [{ filename: 'app:///main.jsbundle', function: 'saveNote', lineno: 42, colno: 9 }] } })
  const text = JSON.stringify(clean)
  for (const secret of ['Private note', 'private@example.com', '/Users/', 'Personal iPad', 'token=secret']) expect(text).not.toContain(secret)
  expect(clean?.user).toBeUndefined()
  expect(clean?.request).toBeUndefined()
  expect(clean?.breadcrumbs).toBeUndefined()
})

it('drops non-error events and arbitrary exception classes', () => {
  expect(sanitizeMobileCrash({ message: 'Private note' })).toBeNull()
  const clean = sanitizeMobileCrash({ exception: { values: [{ type: 'private note title', value: 'secret' }] } })
  expect(clean?.exception?.values?.[0]?.type).toBe('Error')
})
