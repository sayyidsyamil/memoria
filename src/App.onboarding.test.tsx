import "./App.testUtils";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

import {
	CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME,
	createSettings,
	expectedDefaultVaultPath,
	mockCommandResults,
	type mockVaultList,
	render,
	SLOW_APP_READY_TIMEOUT_MS,
} from "./App.testUtils";

describe("App.onboarding", () => {
	it("shows onboarding after telemetry consent when no active vault is configured", async () => {
		mockCommandResults.get_settings = createSettings({
			telemetry_consent: null,
		});
		mockCommandResults.load_vault_list = {
			vaults: [],
			active_vault: null,
			hidden_defaults: [],
		};
		mockCommandResults.get_ai_agents_status = () => new Promise(() => {});
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			args?.path === expectedDefaultVaultPath;

		render(<App />);

		await waitFor(
			() => {
				expect(screen.getByText("Help improve Memoria")).toBeInTheDocument();
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);

		fireEvent.click(screen.getByTestId("telemetry-accept"));

		await waitFor(
			() => {
				expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);
		expect(screen.getByTestId("welcome-open-folder")).toHaveTextContent(
			"Open a workspace",
		);
	});

	it.each([
		["telemetry-accept", "Allow anonymous reporting"],
		["telemetry-decline", "No thanks"],
	])(
		"ignores a remembered default vault after %s when onboarding was never completed",
		async (buttonTestId) => {
			const rememberedDefaultVaultPath = expectedDefaultVaultPath;
			localStorage.setItem("memoria_welcome_dismissed", "1");
			mockCommandResults.get_default_vault_path = rememberedDefaultVaultPath;
			mockCommandResults.get_settings = createSettings({
				telemetry_consent: null,
			});
			mockCommandResults.load_vault_list = {
				vaults: [],
				active_vault: rememberedDefaultVaultPath,
				hidden_defaults: [],
			};
			mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
				args?.path === rememberedDefaultVaultPath;

			render(<App />);

			await waitFor(
				() => {
					expect(screen.getByText("Help improve Memoria")).toBeInTheDocument();
				},
				{ timeout: SLOW_APP_READY_TIMEOUT_MS },
			);

			fireEvent.click(screen.getByTestId(buttonTestId));

			await waitFor(
				() => {
					expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
				},
				{ timeout: SLOW_APP_READY_TIMEOUT_MS },
			);
			expect(screen.getByTestId("welcome-open-folder")).toHaveTextContent(
				"Open a workspace",
			);
		},
	);

	it("keeps one startup shell visible while the last vault is still resolving", async () => {
		localStorage.setItem("memoria_welcome_dismissed", "1");

		let resolveVaultList: ((value: typeof mockVaultList) => void) | null = null;

		mockCommandResults.load_vault_list = () =>
			new Promise<typeof mockVaultList>((resolve) => {
				resolveVaultList = resolve;
			});
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			args?.path === "/work";

		render(<App />);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(screen.getByTestId("startup-shell-fallback")).toBeInTheDocument();
		expect(
			screen.queryByTestId("note-list-loading-skeleton"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByTestId("status-vault-reloading"),
		).not.toBeInTheDocument();

		await act(async () => {
			resolveVaultList?.({
				vaults: [{ label: "Work Vault", path: "/work" }],
				active_vault: "/work",
				hidden_defaults: [],
			});
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				screen.queryByTestId("startup-shell-fallback"),
			).not.toBeInTheDocument();
			expect(screen.getByTestId("status-vault-trigger")).toHaveTextContent(
				"Work Vault",
			);
		});
	});

	it("shows the missing-vault screen once the resolved active vault is confirmed missing", async () => {
		localStorage.setItem("memoria_welcome_dismissed", "1");
		mockCommandResults.load_vault_list = {
			vaults: [{ label: "Old Vault", path: "/missing-vault" }],
			active_vault: "/missing-vault",
			hidden_defaults: [],
		};
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			args?.path === expectedDefaultVaultPath;

		render(<App />);

		await waitFor(
			() => {
				expect(
					screen.getByText(/folder you used before may have moved or been deleted/),
				).toBeInTheDocument();
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);
		expect(screen.getByTestId("welcome-open-folder")).toHaveTextContent(
			"Open a workspace",
		);
	});

	it("shows welcome instead of vault-missing when the missing path was not a persisted active vault", async () => {
		localStorage.setItem("memoria_welcome_dismissed", "1");
		mockCommandResults.load_vault_list = {
			vaults: [],
			active_vault: null,
			hidden_defaults: [],
		};
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			args?.path === expectedDefaultVaultPath;

		render(<App />);

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { level: 1, name: "Memoria" }),
			).toBeInTheDocument();
		});
		expect(screen.getByTestId("welcome-open-folder")).toHaveTextContent(
			"Open a workspace",
		);
	});

	it("persists an existing vault and opens it without asking about coding agents", async () => {
		const selectedVaultPath = "/Users/mock/Documents/Work Vault";
		const saveVaultList = vi.fn();
		const promptSpy = vi
			.spyOn(window, "prompt")
			.mockReturnValue("file:///Users/mock/Documents/Work%20Vault");

		localStorage.removeItem(CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME);
		localStorage.removeItem("memoria:ai-agents-onboarding-dismissed");
		mockCommandResults.load_vault_list = {
			vaults: [],
			active_vault: null,
			hidden_defaults: [],
		};
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			args?.path === selectedVaultPath;
		mockCommandResults.get_ai_agents_status = () => new Promise(() => {});
		mockCommandResults.save_vault_list = (args?: {
			list?: {
				vaults?: Array<{ label: string; path: string }>;
				active_vault?: string | null;
			};
		}) => {
			saveVaultList(args);
			return null;
		};

		render(<App />);

		await waitFor(
			() => {
				expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);

		fireEvent.click(screen.getByTestId("welcome-open-folder"));

		await waitFor(() => {
			expect(saveVaultList).toHaveBeenCalledWith({
				list: {
					vaults: [
						{
							label: "Work Vault",
							path: selectedVaultPath,
							alias: null,
							color: null,
							icon: null,
							mounted: true,
						},
					],
					active_vault: selectedVaultPath,
					default_workspace_path: selectedVaultPath,
					hidden_defaults: [],
				},
			});
		});
		expect(saveVaultList).toHaveBeenCalledTimes(1);

		// Memoria's AI runs inside the app: the inherited question about coding agents is not asked.
		await waitFor(
			() => {
				expect(screen.getByTestId("status-settings")).toBeInTheDocument();
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);
		expect(
			screen.queryByTestId("ai-agents-onboarding-screen"),
		).not.toBeInTheDocument();
		expect(screen.queryByText("AI setup is optional")).not.toBeInTheDocument();
		fireEvent.click(screen.getByTestId("status-settings"));
		expect(screen.getByTestId("settings-panel")).toBeInTheDocument();

		promptSpy.mockRestore();
	});

	it("creates a workspace from the welcome screen without downloading anything", async () => {
		const createdPath = "/Users/mock/Documents/Pilot";
		const saveVaultList = vi.fn();
		const cloneTemplate = vi.fn(() => expectedDefaultVaultPath);
		const promptSpy = vi
			.spyOn(window, "prompt")
			.mockReturnValue("file:///Users/mock/Documents/Pilot");
		let created = false;

		mockCommandResults.load_vault_list = {
			vaults: [],
			active_vault: null,
			hidden_defaults: [],
		};
		mockCommandResults.check_vault_exists = (args?: { path?: string }) =>
			created && args?.path === createdPath;
		mockCommandResults.create_empty_vault = (args?: { targetPath?: string }) => {
			created = true;
			return args?.targetPath ?? createdPath;
		};
		mockCommandResults.create_getting_started_vault = cloneTemplate;
		mockCommandResults.save_vault_list = (args?: {
			list?: {
				vaults?: Array<{ label: string; path: string }>;
				active_vault?: string | null;
			};
		}) => {
			saveVaultList(args);
			return null;
		};

		render(<App />);

		await waitFor(() => {
			expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
		});
		expect(screen.queryByTestId("welcome-create-vault")).not.toBeInTheDocument();
		expect(screen.getByTestId("welcome-create-new")).toHaveTextContent(
			"Create a workspace",
		);

		fireEvent.click(screen.getByTestId("welcome-create-new"));

		await waitFor(() => {
			expect(saveVaultList).toHaveBeenCalled();
		});
		expect(saveVaultList.mock.calls[0][0]).toMatchObject({
			list: { active_vault: createdPath },
		});
		expect(cloneTemplate).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(screen.getByTestId("status-vault-trigger")).toHaveTextContent(
				"Pilot",
			);
		});

		promptSpy.mockRestore();
	});
});
