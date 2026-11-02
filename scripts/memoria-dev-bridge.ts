// Development only: lets the browser build (`pnpm dev`) show Memoria's meeting, knowledge and
// tracked-fact screens against a real vault by answering the desktop commands with the same
// engine.py requests the Rust commands send. Set MEMORIA_DEV_VAULT to the vault to open, and
// MEMORIA_QWEN_SOCKET / MEMORIA_EMBED_SOCKET to a running app's workers for model-backed actions.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

const ENGINE = path.resolve(
	import.meta.dirname,
	"../src-tauri/resources/memory/engine.py",
);
const PYTHON =
	process.env.MEMORIA_MEMORY_PYTHON ?? "/opt/homebrew/bin/python3.11";

type Reply = { ok: true; value: unknown } | { ok: false; error: unknown };

function runEngine(request: Record<string, unknown>): Promise<Reply> {
	return new Promise((resolve) => {
		const child = spawn(PYTHON, ["-u", ENGINE], {
			env: {
				...process.env,
				PYTHONDONTWRITEBYTECODE: "1",
				HF_HUB_OFFLINE: "1",
				TRANSFORMERS_OFFLINE: "1",
			},
		});
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on("error", () =>
			resolve({ ok: false, error: "Local memory runtime unavailable." }),
		);
		child.on("close", () => {
			const lines = output.split("\n").filter((line) => line.trim());
			const replies = lines
				.map((line) => {
					try {
						return JSON.parse(line) as Record<string, unknown>;
					} catch {
						return null;
					}
				})
				.filter((value) => value !== null && !("progress" in value));
			const reply = replies.at(-1);
			if (!reply) {
				resolve({ ok: false, error: "Memory runtime failed." });
			} else if (typeof reply.error === "string") {
				resolve({ ok: false, error: reply.error });
			} else {
				resolve({ ok: true, value: reply.result });
			}
		});
		child.stdin.end(JSON.stringify(request));
	});
}

// Mirrors src-tauri/src/commands/{wiki_memory,temporal,meetings}.rs: the command's arguments
// become one engine request, and typed APIs unwrap {ok, data, error}.
async function dispatch(
	cmd: string,
	args: Record<string, unknown>,
): Promise<Reply | null> {
	const vault = process.env.MEMORIA_DEV_VAULT;
	switch (cmd) {
		case "load_vault_list":
			return vault
				? {
						ok: true,
						value: {
							vaults: [{ label: path.basename(vault), path: vault }],
							active_vault: vault,
						},
					}
				: null;
		case "get_default_vault_path":
			return vault ? { ok: true, value: vault } : null;
		case "check_vault_exists":
			return vault
				? { ok: true, value: existsSync(String(args.path ?? "")) }
				: null;
		case "ai_model_status": {
			const state = (socket?: string) => ({
				state: socket ? "ready" : "queued",
			});
			return {
				ok: true,
				value: {
					speech: state(process.env.MEMORIA_SPEECH_SOCKET),
					qwen: state(process.env.MEMORIA_QWEN_SOCKET),
					embed: state(process.env.MEMORIA_EMBED_SOCKET),
				},
			};
		}
		case "list_recoverable_recordings":
			return { ok: true, value: { recordings: [], activeRecording: false } };
		case "cancel_wiki_memory":
			return { ok: true, value: null };
		case "wiki_memory":
			return runEngine(args.request as Record<string, unknown>);
		case "temporal_api":
		case "meetings_api":
		case "live_memory_check": {
			const request = (args.request ?? {}) as Record<string, unknown>;
			const engineRequest =
				cmd === "temporal_api"
					? {
							action: "temporal_api",
							vaultPath: request.vaultPath,
							method: request.method,
							params: request.params ?? {},
						}
					: cmd === "meetings_api"
						? {
								action: "meeting_api",
								vaultPath: request.vaultPath,
								operation: request.operation,
								id: request.id,
								record: request.record,
							}
						: {
								action: "live_check",
								vaultPath: args.vaultPath,
								statement: args.statement,
							};
			const reply = await runEngine(engineRequest);
			if (!reply.ok) return reply;
			const value = reply.value as {
				ok?: boolean;
				data?: unknown;
				error?: unknown;
			};
			return value?.ok === true
				? { ok: true, value: value.data }
				: { ok: false, error: value?.error ?? "Request failed." };
		}
		case "live_ask":
			return runEngine({
				action: "live_ask",
				vaultPath: args.vaultPath,
				question: args.question,
				sessionText: args.sessionText,
			});
		default:
			return null;
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
	});
}

function send(res: ServerResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

export function memoriaDevBridgePlugin(): Plugin {
	return {
		name: "memoria-dev-bridge",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (req.url !== "/api/memoria/invoke" || req.method !== "POST") {
					next();
					return;
				}
				const { cmd, args } = JSON.parse(await readBody(req)) as {
					cmd: string;
					args?: Record<string, unknown>;
				};
				const reply = await dispatch(cmd, args ?? {});
				if (!reply) send(res, 404, { unhandled: cmd });
				else if (reply.ok) send(res, 200, { value: reply.value });
				else send(res, 200, { error: reply.error });
			});
		},
	};
}
