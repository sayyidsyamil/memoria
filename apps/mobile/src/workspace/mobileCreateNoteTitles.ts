import { slugifyNoteStem } from '../../../../src/utils/noteSlug'

type NoteTitle = string

export function mobileCreateNotePathTitle({
  now,
  title,
  type,
}: {
  now: number
  title: NoteTitle
  type: NoteTitle
}): NoteTitle {
  const trimmedTitle = title.trim()
  if (trimmedTitle) return trimmedTitle

  const typeSlug = type === 'Note' ? 'note' : slugifyNoteStem(type)
  const slug = `untitled-${typeSlug}-${Math.floor(now / 1000)}`
  const words: string[] = []
  for (const part of slug.split('-')) {
    if (part) words.push(part.charAt(0).toUpperCase() + part.slice(1))
  }
  return words.join(' ')
}
