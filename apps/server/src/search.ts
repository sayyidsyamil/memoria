import type { FileEntry, SearchResponse, SearchResult } from '../../../packages/protocol/src/index.ts'
import type { GitRepo } from './gitRepo.ts'

const MATCHES_PER_FILE = 3
const MAX_MATCH_CHARS = 300

function pathMatches(files: FileEntry[], needle: string): Map<string, SearchResult> {
  const byPath = new Map<string, SearchResult>()
  for (const { path } of files) {
    if (path.toLowerCase().includes(needle)) byPath.set(path, { path, pathMatch: true, matches: [] })
  }
  return byPath
}

function addContentMatch(byPath: Map<string, SearchResult>, record: string): void {
  const [path, line, ...text] = record.split('\0')
  if (!path || !line) return
  const result = byPath.get(path) ?? { path, pathMatch: false, matches: [] }
  result.matches.push({ line: Number(line), text: text.join('').slice(0, MAX_MATCH_CHARS) })
  byPath.set(path, result)
}

/** Case-insensitive literal search over tracked text files, plus path matches. */
export async function searchVault(
  repo: GitRepo,
  files: FileEntry[],
  query: string,
  limit: number,
): Promise<SearchResponse> {
  const byPath = pathMatches(files, query.toLowerCase())
  const grep = await repo.run(
    ['grep', '-I', '-i', '-F', '-n', '-z', `--max-count=${MATCHES_PER_FILE}`, '-e', query],
    { okCodes: [1] },
  )
  for (const record of grep.stdout.split('\n')) addContentMatch(byPath, record)
  const results = [...byPath.values()]
  return { results: results.slice(0, limit), truncated: results.length > limit }
}
