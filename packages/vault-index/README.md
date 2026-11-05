# @memoria/vault-index

TypeScript vault indexer that turns note files + frontmatter into `VaultEntry` objects.

## Features

- Parses markdown files with YAML frontmatter
- Extracts title, type, properties, relationships, and metadata
- Identifies outgoing wikilinks
- Generates note snippets
- Calculates word count
- Runs in both Node.js and browser environments

## Usage

```typescript
import { buildVaultIndex, type VaultFile, type VaultEntry } from '@memoria/vault-index'

const files: VaultFile[] = [
  {
    relativePath: 'note.md',
    content: '---\ntitle: My Note\n---\n\nContent here',
    size: 42,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  },
]

const entries: VaultEntry[] = buildVaultIndex(files)
```

## API

### `buildVaultIndex(files: VaultFile[]): VaultEntry[]`

Main entry point. Indexes an array of vault files and returns structured entries.

### Types

- `VaultFile`: Input file with path, content, and metadata
- `VaultEntry`: Output entry with parsed frontmatter, links, snippet, etc.

## Testing

```bash
pnpm test
```

## Design

This package is seeded from mobile's TS snapshot code (`apps/mobile/src/workspace/localVaultSnapshot.ts`, `localVaultFrontmatter.ts`) but simplified for cross-platform vault indexing. It must match the golden fixtures from TOL-147 field-for-field.
