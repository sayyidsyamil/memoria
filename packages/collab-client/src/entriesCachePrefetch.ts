/**
 * Starts the cached entries read as the page boots, so the snapshot is ready by the time the
 * shell asks for the note list (TOL-206). Web-only, like the cache itself.
 */

import {
	type CachedEntries,
	DEFAULT_CACHE_KEY,
	readCache,
} from "./entriesCache.ts";

let prefetched: { key: string; read: Promise<CachedEntries | null> } | null =
	null;

/** Begins reading the snapshot of `key` now; the next `takeCache` of that key gets this read. */
export function prefetchCache(key: string = DEFAULT_CACHE_KEY): void {
	prefetched ??= { key, read: readCache(key) };
}

/** The read `prefetchCache` started for `key`, or a fresh one. Each prefetch serves one read. */
export function takeCache(
	key: string = DEFAULT_CACHE_KEY,
): Promise<CachedEntries | null> {
	const read = prefetched?.key === key ? prefetched.read : readCache(key);
	prefetched = null;
	return read;
}
