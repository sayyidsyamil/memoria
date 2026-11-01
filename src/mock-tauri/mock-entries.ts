/**
 * Mock vault entries and bulk entry generator.
 * Provides realistic VaultEntry[] data for browser dev mode.
 */

import type { VaultEntry } from '../types'
import { resolveBrowserBackendKind } from '../lib/platformCapabilities'
import { generateBulkEntries } from './mockBulkEntries'
import { MOCK_ENTRIES_PART_1 } from './mockEntriesPart1'
import { MOCK_ENTRIES_PART_2 } from './mockEntriesPart2'
import { MOCK_ENTRIES_PART_3 } from './mockEntriesPart3'

// The hand-written demo entries live in three files to keep each one small.
export const MOCK_ENTRIES: VaultEntry[] = [...MOCK_ENTRIES_PART_1, ...MOCK_ENTRIES_PART_2, ...MOCK_ENTRIES_PART_3]

// Append 9000 generated entries for realistic large-vault testing. A Memoria remote never lists
// demo data, and generating it held its startup back (TOL-206).
if (resolveBrowserBackendKind() !== 'remote') MOCK_ENTRIES.push(...generateBulkEntries(9000))
