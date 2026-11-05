import { expect, type Page, test } from "@playwright/test";

interface MockConfig {
	availablePaths: string[];
	hangAgentProbe?: boolean;
	promptPath: string;
}

interface PersistedState {
	active_vault: string | null;
	availablePaths: string[];
	default_workspace_path: string | null;
	hidden_defaults: string[];
	vaults: Array<{
		alias: string | null;
		color: string | null;
		icon: string | null;
		label: string;
		mounted: boolean;
		path: string;
	}>;
}

const GETTING_STARTED_PATH = "/Users/mock/Documents/Getting Started";
const STATE_KEY = "memoria:test-vault-state";

async function installOnboardingVaultMocks(page: Page, config: MockConfig) {
	await page.addInitScript((mockConfig) => {
		const stateKey = "memoria:test-vault-state";
		const defaultSettings = {
			auto_pull_interval_minutes: null,
			telemetry_consent: true,
			crash_reporting_enabled: null,
			analytics_enabled: null,
			anonymous_id: null,
			release_channel: null,
		};
		const buildEntries = (vaultPath: string) => {
			if (!vaultPath) {
				return [];
			}

			return [
				{
					path: `${vaultPath}/welcome.md`,
					filename: "welcome.md",
					title: "Welcome",
					isA: "Note",
					aliases: [],
					belongsTo: [],
					relatedTo: [],
					status: null,
					archived: false,
					modifiedAt: 1700000000,
					createdAt: null,
					fileSize: 256,
					snippet: "Welcome note",
					wordCount: 3,
					relationships: {},
					properties: {},
					template: null,
					sort: null,
					outgoingLinks: [],
				},
			];
		};
		const defaultState = {
			vaults: [],
			active_vault: null,
			default_workspace_path: null,
			hidden_defaults: [],
			availablePaths: [...mockConfig.availablePaths],
		};

		const readState = (): PersistedState => {
			const raw = localStorage.getItem(stateKey);
			return raw ? (JSON.parse(raw) as PersistedState) : defaultState;
		};

		const writeState = (state: PersistedState) => {
			localStorage.setItem(stateKey, JSON.stringify(state));
		};

		if (!mockConfig.hangAgentProbe) {
			localStorage.setItem("memoria:ai-agents-onboarding-dismissed", "1");
			localStorage.setItem("memoria:claude-code-onboarding-dismissed", "1");
		} else {
			localStorage.removeItem("memoria:ai-agents-onboarding-dismissed");
			localStorage.removeItem("memoria:claude-code-onboarding-dismissed");
		}
		if (!localStorage.getItem(stateKey)) {
			writeState(defaultState);
		}

		Object.defineProperty(window, "prompt", {
			configurable: true,
			value: () => mockConfig.promptPath,
		});

		function installVaultListHandlers(handlers: Record<string, unknown>) {
			handlers.load_vault_list = () => {
				const state = readState();
				return {
					vaults: [...state.vaults],
					active_vault: state.active_vault,
					default_workspace_path: state.default_workspace_path,
					hidden_defaults: [...state.hidden_defaults],
				};
			};
			handlers.save_vault_list = (args: { list: PersistedState }) => {
				const state = readState();
				writeState({
					...state,
					vaults: [...args.list.vaults],
					active_vault: args.list.active_vault,
					default_workspace_path: args.list.default_workspace_path,
					hidden_defaults: [...(args.list.hidden_defaults ?? [])],
				});
				return null;
			};
		}

		function installVaultAvailabilityHandlers(
			handlers: Record<string, unknown>,
		) {
			handlers.get_default_vault_path = () =>
				"/Users/mock/Documents/Getting Started";
			handlers.check_vault_exists = (args: { path?: string | null }) => {
				const state = readState();
				return !!args.path && state.availablePaths.includes(args.path);
			};
			handlers.create_getting_started_vault = (args: {
				targetPath?: string | null;
			}) => {
				if (!args.targetPath) {
					throw new Error("Target path is required");
				}
				const state = readState();
				writeState({
					...state,
					availablePaths: [
						...new Set([...state.availablePaths, args.targetPath]),
					],
				});
				return args.targetPath;
			};
		}

		function installVaultContentHandlers(handlers: Record<string, unknown>) {
			handlers.list_vault = (args: { path?: string | null }) =>
				buildEntries(args.path ?? readState().active_vault ?? "");
			handlers.list_vault_folders = () => [];
			handlers.list_views = () => [];
			handlers.get_all_content = () => {
				const activeVault = readState().active_vault ?? "";
				return Object.fromEntries(
					buildEntries(activeVault).map((entry) => [
						entry.path,
						"# Welcome\n\nWelcome note",
					]),
				);
			};
			handlers.get_note_content = () => "# Welcome\n\nWelcome note";
			handlers.get_modified_files = () => [];
			handlers.get_file_history = () => [];
		}

		function installSettingsHandlers(handlers: Record<string, unknown>) {
			handlers.get_settings = () => defaultSettings;
			handlers.save_settings = () => null;
			if (mockConfig.hangAgentProbe) {
				handlers.get_ai_agents_status = () => new Promise(() => {});
			}
		}

		function installMockHandlers() {
			let ref: Record<string, unknown> | null = null;

			Object.defineProperty(window, "__mockHandlers", {
				configurable: true,
				set(value) {
					ref = value as Record<string, unknown>;
					installVaultListHandlers(ref);
					installVaultAvailabilityHandlers(ref);
					installVaultContentHandlers(ref);
					installSettingsHandlers(ref);
				},
				get() {
					return ref;
				},
			});
		}

		installMockHandlers();
	}, config);
}

async function readPersistedState(page: Page): Promise<PersistedState> {
	return page.evaluate(
		(stateKey) =>
			JSON.parse(localStorage.getItem(stateKey) ?? "null") as PersistedState,
		STATE_KEY,
	);
}

test("opening an existing vault from onboarding persists the selection and survives reload @smoke", async ({
	page,
}) => {
	const vaultPath = "/Users/mock/Work";
	const vaultUrl = "file:///Users/mock/Work";

	await installOnboardingVaultMocks(page, {
		availablePaths: [vaultPath],
		promptPath: vaultUrl,
	});

	await page.goto("/", { waitUntil: "domcontentloaded" });

	await expect(page.getByTestId("welcome-screen")).toBeVisible();
	await page.getByTestId("welcome-open-folder").click();

	await expect(page.getByTestId("note-list-container")).toBeVisible({
		timeout: 5_000,
	});
	await expect(page.getByTestId("status-vault-trigger")).toContainText("Work");

	await expect
		.poll(() => readPersistedState(page))
		.toEqual({
			vaults: [
				{
					alias: null,
					color: null,
					icon: null,
					label: "Work",
					mounted: true,
					path: vaultPath,
				},
			],
			active_vault: vaultPath,
			default_workspace_path: vaultPath,
			hidden_defaults: [],
			availablePaths: [vaultPath],
		});

	await page.reload({ waitUntil: "domcontentloaded" });

	await expect(page.getByTestId("welcome-screen")).not.toBeVisible();
	await expect(page.getByTestId("status-vault-trigger")).toContainText("Work");
	await expect(page.getByTestId("note-list-container")).toBeVisible();
});

test("cloning Getting Started from onboarding persists the default vault and survives reload @smoke", async ({
	page,
}) => {
	await installOnboardingVaultMocks(page, {
		availablePaths: [],
		promptPath: "file:///Users/mock/Documents",
	});

	await page.goto("/", { waitUntil: "domcontentloaded" });

	await expect(page.getByTestId("welcome-screen")).toBeVisible();
	await page.getByTestId("welcome-create-vault").click();

	await expect(page.getByTestId("note-list-container")).toBeVisible({
		timeout: 5_000,
	});
	await expect(page.getByTestId("status-vault-trigger")).toContainText(
		"Getting Started",
	);

	await expect
		.poll(async () => (await readPersistedState(page)).active_vault)
		.toBe(GETTING_STARTED_PATH);
	await expect
		.poll(async () => (await readPersistedState(page)).availablePaths)
		.toEqual([GETTING_STARTED_PATH]);

	await page.reload({ waitUntil: "domcontentloaded" });

	await expect(page.getByTestId("welcome-screen")).not.toBeVisible();
	await expect(page.getByTestId("status-vault-trigger")).toContainText(
		"Getting Started",
	);
	await expect(page.getByTestId("note-list-container")).toBeVisible();
});

test("a hanging AI agent probe does not block first-run onboarding or Settings @smoke", async ({
	page,
}) => {
	const vaultPath = "/Users/mock/Work";

	await installOnboardingVaultMocks(page, {
		availablePaths: [vaultPath],
		hangAgentProbe: true,
		promptPath: "file:///Users/mock/Work",
	});

	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(page.getByTestId("welcome-screen")).toBeVisible();
	await page.getByTestId("welcome-open-folder").click();

	await expect(page.getByTestId("ai-agents-onboarding-screen")).toBeVisible({
		timeout: 5_000,
	});
	await expect(
		page.getByRole("button", { name: "Set up later" }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Set up later" }).click();

	await expect(page.getByTestId("status-settings")).toBeVisible({
		timeout: 5_000,
	});
	await page.getByTestId("status-settings").click();
	await expect(page.getByTestId("settings-panel")).toBeVisible();
});
