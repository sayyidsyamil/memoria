# Search Index Performance

## Benchmark Results (6,000 notes)

Run 1:
- Mean: 220.88 ms
- p50: 264.63 ms
- p95: 296.98 ms ✓ (< 300ms target)
- p99: 340.94 ms

Run 2:
- Mean: 211.29 ms
- p50: 257.21 ms
- p95: 275.41 ms ✓ (< 300ms target)
- p99: 289.56 ms

## Implementation

The search index is implemented in `apps/server/src/searchIndex.ts` and provides:
- In-memory search index persisted via BlobStore
- Incremental updates on write, rename, and delete via onChange listener
- Full rebuild from git clone when stale or missing
- Case-insensitive search with ranking similar to desktop search.rs
- Snippet extraction matching desktop behavior

## Test Coverage

16 unit tests in `apps/server/test/searchIndex.test.ts` covering:
- Basic search functionality (title and content matching)
- Case-insensitive search
- Ranking (title matches higher than content matches)
- Snippet extraction with Unicode support
- Frontmatter and code block exclusion
- Incremental updates (write, delete, rename)
- Index persistence and rebuild
- Search limits and result truncation
