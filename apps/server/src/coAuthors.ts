import {
  ACCESS_AUTHOR_MAX_EMAIL_LENGTH,
  ACCESS_AUTHOR_MAX_NAME_LENGTH,
  type AccessTicketAuthor,
} from '../../../packages/protocol/src/index.ts'

/**
 * Who else made a commit the server writes as the vault owner (protocol 1.10, ADR 0297). Each
 * becomes a `Co-authored-by: <name> <<email>>` trailer; a commit without any keeps the
 * message it always had.
 */
export type CoAuthor = AccessTicketAuthor

const TRAILER_KEY = 'Co-authored-by'
/** Control characters would break the trailer line; angle brackets would break its address. */
const UNSAFE = /[\p{Cc}<>]/u
const EMAIL = /^[^\s@]+@[^\s@]+$/
const TRAILER_VALUE = /^(.+) <([^<>]+)>$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value instanceof Object && !Array.isArray(value)
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && value.trim() === value && !UNSAFE.test(value)
}

/** A name and an address that fit on one trailer line. */
export function isCoAuthor(value: unknown): value is CoAuthor {
  if (!isRecord(value)) return false
  const { name, email } = value
  return (
    safeText(name, ACCESS_AUTHOR_MAX_NAME_LENGTH) &&
    name.length > 0 &&
    safeText(email, ACCESS_AUTHOR_MAX_EMAIL_LENGTH) &&
    EMAIL.test(email)
  )
}

/** The trailer lines of a commit message: empty when nobody else took part. */
export function coAuthorTrailers(coAuthors: readonly CoAuthor[]): string {
  return coAuthors.map(({ name, email }) => `${TRAILER_KEY}: ${name} <${email}>`).join('\n')
}

/** Reads back the value of a trailer the server wrote; null for anything else. */
export function parseCoAuthor(value: string): CoAuthor | null {
  const match = TRAILER_VALUE.exec(value.trim())
  if (!match) return null
  const author = { name: match[1], email: match[2] }
  return isCoAuthor(author) ? author : null
}

/** The `git log` format that prints one commit's co-author trailers, one value per line. */
export const CO_AUTHOR_LOG_FORMAT = `--format=%(trailers:key=${TRAILER_KEY},valueonly,unfold)`

/** People in the order they first took part, once each: the address tells them apart. */
export class CoAuthors {
  private readonly byEmail = new Map<string, CoAuthor>()

  constructor(coAuthors: readonly CoAuthor[] = []) {
    this.add(coAuthors)
  }

  add(coAuthors: readonly CoAuthor[]): void {
    for (const author of coAuthors) {
      const key = author.email.toLowerCase()
      if (!this.byEmail.has(key)) this.byEmail.set(key, author)
    }
  }

  list(): CoAuthor[] {
    return [...this.byEmail.values()]
  }

  /** Everyone so far, forgotten here. */
  take(): CoAuthor[] {
    const taken = this.list()
    this.byEmail.clear()
    return taken
  }
}
