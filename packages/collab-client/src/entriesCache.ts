/**
 * IndexedDB cache for vault entries, enabling instant startup from a snapshot
 * while revalidating in the background. Web-only; gracefully unavailable when
 * IndexedDB is blocked or fails.
 */

import type { VaultEntry as ProtocolVaultEntry } from "../../protocol/src/index.ts";

const DB_NAME = "memoria-entries";
const DB_VERSION = 1;
const STORE_NAME = "entries";
/** The key of the page's own vault; a shared vault (TOL-237) is cached under a key of its own. */
export const DEFAULT_CACHE_KEY = "snapshot";

/**
 * The cache key of the vault served under `baseUrl`: the page's own vault at the origin keeps
 * the key it always had, a vault under a path prefix (`/vaults/<id>`) gets one of its own.
 */
export function entriesCacheKey(baseUrl: string): string {
	const prefix = baseUrl ? new URL(baseUrl, "http://localhost").pathname : "/";
	return prefix === "/" ? DEFAULT_CACHE_KEY : `${DEFAULT_CACHE_KEY}:${prefix}`;
}

export interface CachedEntries {
	head: string;
	entries: ProtocolVaultEntry[];
	cachedAt: number;
}

/**
 * Opens the IndexedDB database. Returns null when IndexedDB is unavailable
 * (private browsing, blocked by policy, or initialization failed).
 */
async function openDB(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return null;

	try {
		return await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME);
				}
			};
		});
	} catch {
		return null;
	}
}

/**
 * Reads the cached entries from IndexedDB. Returns null when the cache is empty
 * or unavailable.
 */
export async function readCache(
	key: string = DEFAULT_CACHE_KEY,
): Promise<CachedEntries | null> {
	const db = await openDB();
	if (!db) return null;

	try {
		return await new Promise<CachedEntries | null>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const data = request.result as CachedEntries | undefined;
				resolve(data ?? null);
			};
		});
	} catch {
		return null;
	} finally {
		db.close();
	}
}

/**
 * Writes entries and the current HEAD to the cache. Writes asynchronously; failures
 * are silent (the cache is a performance optimization, not a requirement).
 */
export async function writeCache(
	head: string,
	entries: ProtocolVaultEntry[],
	key: string = DEFAULT_CACHE_KEY,
): Promise<void> {
	const db = await openDB();
	if (!db) return;

	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const snapshot: CachedEntries = {
				head,
				entries,
				cachedAt: Date.now(),
			};
			const request = store.put(snapshot, key);

			request.onerror = () => reject(request.error);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Cache write failures are silent
	} finally {
		db.close();
	}
}

/**
 * Clears the cache of every vault. Used when the account leaves or a cache becomes invalid.
 */
export async function clearCache(): Promise<void> {
	const db = await openDB();
	if (!db) return;

	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.clear();

			request.onerror = () => reject(request.error);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Cache clear failures are silent
	} finally {
		db.close();
	}
}
