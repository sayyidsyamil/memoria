interface SourceNoteMetadata {
  sourceType?: string
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}

function metadataLines(metadata: SourceNoteMetadata): string[] {
  const lines = [
    'type: Source',
    '_organized: true',
    'status: ready_to_compile',
  ]
  const sourceType = metadata.sourceType?.trim()
  if (sourceType) lines.push(`source_type: ${quoteYamlString(sourceType)}`)
  return lines
}

export function withSourceNoteMetadata(markdown: string, metadata: SourceNoteMetadata = {}): string {
  const fields = metadataLines(metadata)
  if (!markdown.startsWith('---\n')) return `---\n${fields.join('\n')}\n---\n\n${markdown}`

  const closingIndex = markdown.indexOf('\n---', 4)
  if (closingIndex < 0) return `---\n${fields.join('\n')}\n---\n\n${markdown}`

  const frontmatter = markdown.slice(4, closingIndex).trimEnd()
  const body = markdown.slice(closingIndex + '\n---'.length).replace(/^\n+/, '')
  const existingLines = frontmatter
    .split('\n')
    .filter((line) => !/^(type|_organized|organized|status|source_type):/iu.test(line.trim()))
    .filter((line) => line.trim().length > 0)

  return `---\n${[...fields, ...existingLines].join('\n')}\n---\n\n${body}`
}
