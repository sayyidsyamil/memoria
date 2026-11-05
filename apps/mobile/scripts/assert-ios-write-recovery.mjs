/* global console, process, setTimeout, clearTimeout */

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNativeSimulatorLease } from "../src/qa/nativeSimulatorLease.ts";
import { startGitTestServer } from "../src/workspace/git/gitTestServer.ts";

const device =
	process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
	"booted";
const bundleId = "com.memoria.mobile.dev";
let awaitingProof;
let timer;

async function collectProof(request, response) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	response.end("ok");
	awaitingProof?.(JSON.parse(Buffer.concat(chunks).toString()));
}

function startCollector(root) {
	return startGitTestServer(root, (request, response) => {
		if (request.url !== "/proof") return false;
		void collectProof(request, response).catch((error) =>
			awaitingProof?.({ passed: false, error: error.message }),
		);
		return true;
	});
}

async function runPhase(phase, collectorUrl) {
	const proof = new Promise((resolve, reject) => {
		awaitingProof = resolve;
		timer = setTimeout(
			() => reject(new Error(`Native recovery phase timed out: ${phase}`)),
			120_000,
		);
	});
	const query = new URLSearchParams({
		source: "fixture",
		gitProbe: collectorUrl,
		writeRecoveryProbe: phase,
		qaRun: phase,
	});
	// Direct launch avoids iOS external-URL confirmation on fresh installs.
	execFileSync("xcrun", [
		"simctl",
		"launch",
		"--terminate-running-process",
		device,
		bundleId,
		"--memoria-mobile-search",
		`?${query}`,
	]);
	const result = await proof;
	clearTimeout(timer);
	if (result.phase !== phase || !result.passed)
		throw new Error(JSON.stringify(result));
	console.log(JSON.stringify(result));
}

function recoveryPhases() {
	if (process.argv.includes("--batch"))
		return [
			"batch-prepare",
			"batch-recover",
			"batch-prepare-conflict",
			"batch-conflict",
		];
	if (process.argv.includes("--entries")) {
		return [
			"entry-prepare-move",
			"entry-move",
			"entry-prepare-delete",
			"entry-delete",
			"entry-prepare-conflict",
			"entry-conflict",
		];
	}
	return ["prepare", "recover", "prepare-conflict", "conflict", "cleanup"];
}

async function runProbe() {
	const root = await mkdtemp(join(tmpdir(), "memoria-write-recovery-"));
	let server;
	try {
		server = await startCollector(root);
		for (const phase of recoveryPhases()) await runPhase(phase, server.url);
	} finally {
		clearTimeout(timer);
		awaitingProof = undefined;
		await server?.close();
		await rm(root, { recursive: true, force: true });
	}
}

await withNativeSimulatorLease(runProbe);
