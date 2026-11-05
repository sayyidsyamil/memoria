import type { LocalVaultEntry, LocalVaultFile } from './localVaultSnapshot'
import type { MobileFileKind } from './mobileWorkspaceModel'

const textFileExtensions = new Set([
  'bash', 'bat', 'c', 'cfg', 'clj', 'cmd', 'conf', 'cpp', 'css', 'csv', 'dockerfile', 'editorconfig',
  'el', 'env', 'erl', 'ex', 'exs', 'fish', 'gitignore', 'go', 'graphql', 'h', 'hcl', 'hpp', 'hs',
  'htm', 'html', 'ini', 'java', 'jl', 'js', 'json', 'jsx', 'kt', 'less', 'lisp', 'lua', 'makefile',
  'mdx', 'ml', 'nix', 'properties', 'ps1', 'py', 'r', 'rb', 'rs', 'scss', 'sh', 'sql', 'svelte',
  'swift', 'tf', 'toml', 'ts', 'tsx', 'txt', 'vim', 'vue', 'xml', 'yaml', 'yml', 'zig', 'zsh',
])
const extensionlessTextFilenames = new Set([
  '.editorconfig', '.env', '.gitattributes', '.gitignore', 'brewfile', 'dockerfile', 'gemfile',
  'makefile', 'procfile', 'rakefile',
])

export function localVaultFileKind(file: LocalVaultFile): MobileFileKind {
  return file.fileKind ?? mobileFileKindForPath(file.relativePath)
}

export function mobileFileKindForPath(path: string): MobileFileKind {
  const filename = path.split('/').at(-1)?.toLowerCase() ?? path.toLowerCase()
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return extensionlessTextFilenames.has(filename) ? 'text' : 'binary'
  }
  const extension = filename.slice(dotIndex + 1)
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  return textFileExtensions.has(extension) ? 'text' : 'binary'
}

export function parseNonMarkdownVaultEntry(file: LocalVaultFile, fileKind: MobileFileKind): LocalVaultEntry {
  const filename = file.relativePath.split('/').at(-1) ?? file.relativePath
  return {
    archived: false, aliases: [], body: fileKind === 'text' ? file.content : '', createdAt: file.createdAt,
    favorite: false, favoriteIndex: null, fileKind, filename, id: file.relativePath, icon: null, links: 0,
    modifiedAt: file.modifiedAt, noteWidth: null, organized: false, outgoingLinks: [], path: file.relativePath,
    properties: [], rawContent: file.content, relationships: {}, status: '', tags: [],
    title: yamlName(file) ?? filename, type: 'File', typeDefinition: {}, typeDefinitionTone: 'gray', typeTone: 'gray',
  }
}

function yamlName(file: LocalVaultFile): string | null {
  const extension = file.relativePath.split('.').at(-1)?.toLowerCase()
  if (extension !== 'yml' && extension !== 'yaml') return null
  const match = file.content.match(/^name:\s*(.+?)\s*$/m)
  if (!match) return null
  const value = match[1].trim()
  return isQuoted(value, '"') || isQuoted(value, "'") ? value.slice(1, -1) : value
}

function isQuoted(value: string, quote: string) { return value.startsWith(quote) && value.endsWith(quote) }
