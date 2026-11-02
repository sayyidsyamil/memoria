/// <reference types="vitest/config" />

import os from "node:os";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { vaultApiPlugin } from "./scripts/vault-api-plugin";
import { memoriaDevBridgePlugin } from "./scripts/memoria-dev-bridge";

const vitestCoverageDirectory =
	process.env.VITEST_COVERAGE_DIR ??
	path.join(os.tmpdir(), "memoria-vitest-coverage", String(process.pid));

const devServerWatchIgnored = [
	"**/coverage/**",
	"**/test-results/**",
	"**/playwright-report/**",
	"**/dist/**",
	"**/src-tauri/target/**",
];

/** WebSocket proxy info endpoint — tells the frontend where the MCP bridge is */
function mcpBridgeInfoPlugin(): Plugin {
	return {
		name: "mcp-bridge-info",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url !== "/api/mcp/info") return next();
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify({
						wsUrl: `ws://localhost:${process.env.MCP_WS_PORT || 9710}`,
						available: true,
					}),
				);
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), vaultApiPlugin(), memoriaDevBridgePlugin(), mcpBridgeInfoPlugin()],
	cacheDir: process.env.MEMORIA_VITE_CACHE_DIR,

	resolve: {
		alias: [
			{ find: "@", replacement: path.resolve(__dirname, "./src") },
			// Development bridge only: route @tauri-apps/api/core's invoke to the browser mock.
			...(process.env.VITE_MEMORIA_DEV_BRIDGE === "1"
				? [
						{
							find: /^@tauri-apps\/api\/core$/,
							replacement: path.resolve(
								__dirname,
								"./src/mock-tauri/tauri-core-shim.ts",
							),
						},
					]
				: []),
		],
	},

	// Inject the demo-vault-v2 path in local dev only — production Tauri builds and
	// CI must resolve the default vault path at runtime via the backend to avoid
	// baking the CI runner's absolute path into the distributed bundle.
	define: {
		...(process.env.CI ||
		(process.env.TAURI_PLATFORM && !process.env.TAURI_DEBUG)
			? {}
			: {
					__DEMO_VAULT_PATH__: JSON.stringify(
						path.resolve(__dirname, "demo-vault-v2"),
					),
				}),
	},

	// Prevent vite from obscuring Rust errors
	clearScreen: false,

	// Tauri expects a fixed port
	server: {
		port: 5202,
		strictPort: true,
		allowedHosts: true,
		watch: {
			ignored: devServerWatchIgnored,
		},
	},

	// Env variables starting with TAURI_ are exposed to the frontend
	envPrefix: ["VITE_", "TAURI_"],

	build: {
		// Tauri uses Chromium on Windows and WebKit on macOS/Linux
		target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
		// Don't minify for debug builds
		minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
		// Produce sourcemaps for debug builds
		sourcemap: !!process.env.TAURI_DEBUG,
	},

	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		// Node 22's experimental Web Storage global can shadow jsdom's storage
		// with an undefined value in workers started without --localstorage-file.
		execArgv: ["--no-experimental-webstorage"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		// The full jsdom suite is heavy enough that unconstrained worker fan-out can
		// starve UI tests on local dev machines. Keep the default hook path stable,
		// while still allowing CI or one-off runs to opt into a different cap.
		maxWorkers: process.env.VITEST_MAX_WORKERS ?? 4,
		testTimeout: Number(process.env.VITEST_TEST_TIMEOUT_MS ?? 10_000),
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			// Keep coverage temp files off the mounted workspace to avoid flaky
			// read-after-write races when Vitest re-reads its own coverage shards.
			reportsDirectory: vitestCoverageDirectory,
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.{test,spec}.{ts,tsx}",
				"src/test/**",
				"src/mock-tauri.ts",
				"src/main.tsx",
				"src/types.ts",
				"src/hooks/useMcpBridge.ts",
				"src/hooks/useAiAgent.ts",
				"src/utils/ai-chat.ts",
				"src/utils/ai-agent.ts",
				"src/components/ui/dropdown-menu.tsx",
				"src/components/ui/scroll-area.tsx",
				"src/components/ui/select.tsx",
				"src/components/ui/separator.tsx",
				"src/components/ui/tabs.tsx",
				"src/components/ui/tooltip.tsx",
				"src/components/ui/card.tsx",
			],
			thresholds: {
				lines: 72,
				functions: 72,
				branches: 72,
				statements: 72,
			},
		},
	},
});
