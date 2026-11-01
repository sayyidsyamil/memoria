import { invoke } from "@tauri-apps/api/core";
import type { RemoteAttachments } from "../../../packages/collab-client/src/remoteAttachments";
import {
	createRemoteAttachments,
	createRemoteVaultBackend,
} from "../../../packages/collab-client/src/remoteVaultBackend";
import { isTauri, mockInvoke } from "../../mock-tauri";
import { createCommandVaultBackend } from "./commandVaultBackend";
import { type RemoteVaultConfig, remoteVaultConfig } from "./remoteConfig";
import type { VaultBackend } from "./types";

export type {
	CommandDialect,
	CommandInvoker,
	CommandVaultBackendOptions,
} from "./commandVaultBackend";
export { createCommandVaultBackend } from "./commandVaultBackend";
export { contentRevision } from "./contentRevision";
export * from "./types";
export { type RemoteVaultConfig, remoteVaultConfig };

/** True in the web build when a Memoria remote serves the vault. */
export function hasRemoteVault(): boolean {
	return !isTauri() && remoteVaultConfig() !== null;
}

/** Image uploads, reads and imports of the configured remote; null without one. */
export function createRemoteAttachmentClient(): RemoteAttachments | null {
	const remoteConfig = hasRemoteVault() ? remoteVaultConfig() : null;
	return remoteConfig ? createRemoteAttachments(remoteConfig) : null;
}

/** The desktop path: Tauri commands backed by the Rust vault crate. */
export function createTauriVaultBackend(vaultPath?: string): VaultBackend {
	return createCommandVaultBackend({ dialect: "tauri", invoke, vaultPath });
}

/** The browser path: mock data, or the dev vault API when it is running. */
export function createMockVaultBackend(vaultPath?: string): VaultBackend {
	return createCommandVaultBackend({
		dialect: "mock",
		invoke: mockInvoke,
		vaultPath,
	});
}

/**
 * Picks the backend for the current runtime. When a remote server is configured
 * (MEMORIA_REMOTE_URL and MEMORIA_REMOTE_TOKEN on window), uses the remote backend.
 * Otherwise falls back to Tauri (desktop) or mock (browser).
 */
export function createVaultBackend(vaultPath?: string): VaultBackend {
	if (isTauri()) return createTauriVaultBackend(vaultPath);

	const remoteConfig = remoteVaultConfig();
	if (remoteConfig) return createRemoteVaultBackend(remoteConfig);

	return createMockVaultBackend(vaultPath);
}
