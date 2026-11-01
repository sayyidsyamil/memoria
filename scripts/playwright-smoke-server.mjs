#!/usr/bin/env node

import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

const port = process.argv[2] ?? process.env.PORT ?? "41741";
const viteCacheDir =
	process.env.MEMORIA_VITE_CACHE_DIR ??
	join(tmpdir(), `memoria-vite-smoke-${port}`);

const server = await createServer({
	cacheDir: viteCacheDir,
	// Scan only the desktop app. The separate web collaboration prototype has
	// dependencies outside this workspace; scanning its HTML aborts prebundling
	// and causes optimizer reloads that erase smoke-test focus and note selection.
	optimizeDeps: { entries: ["index.html"] },
	server: { host: "127.0.0.1", port: Number(port), strictPort: true },
});

async function stopServer() {
	await server.close();
	process.exit(0);
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);

await server.listen();
server.printUrls();
