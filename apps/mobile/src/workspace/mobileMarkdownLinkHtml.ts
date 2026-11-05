import { nextMarkdownLink } from './mobileMarkdownLinkParser'
import { escapeAttribute, unescapeHtml } from './mobileHtmlEncoding'
type MarkdownLine = string
type UrlText = string
type LinkLabel = string
type WikilinkTarget = string
const WIKILINK_HREF_PREFIX = 'memoria://wikilink/'
const allowedLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:', 'memoria:'])
const aliasedWikilinkPattern = /\[\[([^\]|]+)\|([^\]]+)]]/g
const wikilinkPattern = /\[\[([^\]]+)]]/g
const uriAutolinkPattern = /&lt;((?:https?|mailto):(?:(?!&gt;)\S)+)&gt;/g
const emailAutolinkPattern = /&lt;([A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})&gt;/g

export function linkifyInlineMarkdown(markdown: MarkdownLine): string {
  return linkifyMarkdownLinks(markdown
    .replace(aliasedWikilinkPattern, (_match, target: WikilinkTarget, display: LinkLabel) => (
      wikilinkHtml(target, display)
    ))
    .replace(wikilinkPattern, (_match, target: WikilinkTarget) => wikilinkHtml(target, target)))
    .replace(uriAutolinkPattern, (_match, href: UrlText) => (
      externalAutolinkHtml(href, href)
    ))
    .replace(emailAutolinkPattern, (
      _match,
      email: LinkLabel,
    ) => emailAutolinkHtml(email))
}

function linkifyMarkdownLinks(markdown: MarkdownLine): string {
  let html = ''
  let cursor = 0

  while (cursor < markdown.length) {
    const link = nextMarkdownLink(markdown, cursor)
    if (!link) return `${html}${markdown.slice(cursor)}`

    html += markdown.slice(cursor, link.start)
    html += markdownLinkHtml(link.href, link.label)
    cursor = link.end
  }

  return html
}

function markdownLinkHtml(href: UrlText, label: LinkLabel): string {
  const destination = markdownLinkHref(href)
  if (!isAllowedLinkDestination(destination)) return label
  return `<a href="${escapeAttribute(destination)}">${label}</a>`
}

function isAllowedLinkDestination(destination: UrlText): boolean {
  const normalized = destination.replace(/[\p{Cc}\s]/gu, '')
  const protocol = /^[a-z][a-z0-9+.-]*:/iu.exec(normalized)?.[0]
  return protocol === undefined || allowedLinkProtocols.has(protocol.toLowerCase())
}

function markdownLinkHref(href: UrlText): UrlText {
  const destination = unescapeHtml(href).trim()
  return destination.startsWith('<') && destination.endsWith('>')
    ? destination.slice(1, -1)
    : destination
}

function wikilinkHtml(target: WikilinkTarget, display: LinkLabel): string {
  const href = `${WIKILINK_HREF_PREFIX}${encodeURIComponent(unescapeHtml(target))}`
  return `<a href="${href}">${display}</a>`
}

function externalAutolinkHtml(href: UrlText, display: LinkLabel): string {
  return `<a href="${escapeAttribute(unescapeHtml(href))}">${display}</a>`
}

function emailAutolinkHtml(email: LinkLabel): string {
  return `<a href="mailto:${escapeAttribute(unescapeHtml(email))}">${email}</a>`
}
