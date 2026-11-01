import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests of the Memoria remote: Node, real git, no jsdom. Run with `pnpm test:server`.
// Kept apart from the root Vite config so the desktop test and coverage runs are unchanged.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root: REPO_ROOT,
  test: {
    environment: 'node',
    include: ['apps/server/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: join(tmpdir(), 'memoria-server-coverage'),
      include: ['apps/server/src/**/*.ts', 'packages/*/src/**/*.ts'],
      // The entry point only wires the tested modules to the process and its environment.
      exclude: ['apps/server/src/main.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
