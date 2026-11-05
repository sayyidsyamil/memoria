import "./App.blocknote.testUtils";
// App interaction tests exercise the real editor with BlockNote's DOM adapter
// above. Collect its large module graph before timing user interactions, rather
// than charging the first note-open assertion for Vite's lazy bundle transform.
import "./components/Editor";
import { invoke } from "@tauri-apps/api/core";
import {
	act,
	fireEvent,
	render as testingLibraryRender,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, expect, vi } from "vitest";
import { TooltipProvider } from "./components/ui/tooltip";
import { useUpdater } from "./hooks/useUpdater";
import { DEFAULT_VAULTS } from "./hooks/useVaultSwitcher";
import { isTauri } from "./mock-tauri";
import type { Settings } from "./types";

// Provide a localStorage mock that supports all methods (jsdom's may be incomplete)
export const localStorageMock = (() => {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	};
})();
Object.defineProperty(globalThis, "localStorage", {
	value: localStorageMock,
	writable: true,
});
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock @tauri-apps/api/core before importing App
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
	isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/window", async () => {
	const actual = await vi.importActual<typeof import("@tauri-apps/api/window")>(
		"@tauri-apps/api/window",
	);

	return {
		...actual,
		getCurrentWindow: () => ({
			innerSize: vi.fn(async () => ({
				toLogical: () => ({ width: 1400, height: 900 }),
			})),
			scaleFactor: vi.fn(async () => 1),
			setMinSize: vi.fn(async () => {}),
			setSize: vi.fn(async () => {}),
		}),
	};
});

// Mock mock-tauri module
export const mockEntries = [
	{
		path: "/vault/project/test.md",
		filename: "test.md",
		title: "Test Project",
		isA: "Project",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: "Active",
		archived: false,
		owner: "Luca",
		cadence: null,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 1024,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: true,
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		outgoingLinks: [],
		properties: {},
		hasH1: true,
		fileKind: "markdown",
	},
	{
		path: "/vault/topic/dev.md",
		filename: "dev.md",
		title: "Software Development",
		isA: "Topic",
		aliases: ["Dev"],
		belongsTo: [],
		relatedTo: [],
		status: null,
		archived: false,
		owner: null,
		cadence: null,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 256,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: true,
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		outgoingLinks: [],
		properties: {},
		hasH1: true,
		fileKind: "markdown",
	},
];

export const mockAllContent: Record<string, string> = {
	"/vault/project/test.md":
		"---\ntitle: Test Project\nis_a: Project\n---\n\n# Test Project\n\nSome content.",
	"/vault/topic/dev.md":
		"---\ntitle: Software Development\nis_a: Topic\n---\n\n# Software Development\n",
};

export const mockVaultList = {
	vaults: [{ label: "Test Vault", path: "/vault" }],
	active_vault: "/vault",
	hidden_defaults: [],
};

export const mockDefaultVaultPath = "/Users/mock/Documents/Getting Started";
export const expectedDefaultVaultPath =
	DEFAULT_VAULTS[0].path || mockDefaultVaultPath;

export function createSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		auto_pull_interval_minutes: null,
		telemetry_consent: true,
		crash_reporting_enabled: null,
		analytics_enabled: null,
		anonymous_id: null,
		release_channel: null,
		...overrides,
	};
}

export const mockCommandResults: Record<string, unknown> = {
	load_vault_list: mockVaultList,
	list_vault: mockEntries,
	list_vault_folders: [],
	list_views: [],
	get_all_content: mockAllContent,
	get_modified_files: [],
	get_note_content: mockAllContent["/vault/project/test.md"] || "",
	save_note_content: null,
	reload_vault_entry: ({ path }: { path: string }) =>
		mockEntries.find((entry) => entry.path === path) ?? null,
	sync_vault_asset_scope_for_window: null,
	get_file_history: [],
	get_settings: createSettings(),
	is_git_repo: true,
	init_git_repo: null,
	git_pull: {
		status: "up_to_date",
		message: "Already up to date",
		updatedFiles: [],
		conflictFiles: [],
	},
	save_settings: null,
	check_vault_exists: true,
	get_default_vault_path: expectedDefaultVaultPath,
	list_themes: [],
	get_vault_settings: { theme: null },
};

export function buildNeighborhoodEntry({
	path,
	title,
	relatedRefs,
	outgoingLinks,
	modifiedAt,
}: {
	path: string;
	title: string;
	relatedRefs: string[];
	outgoingLinks: string[];
	modifiedAt: number;
}) {
	return {
		path,
		filename: path.split("/").pop() ?? `${title.toLowerCase()}.md`,
		title,
		isA: "Note",
		aliases: [],
		belongsTo: [],
		relatedTo: relatedRefs,
		status: null,
		modifiedAt,
		createdAt: null,
		fileSize: 128,
		archived: false,
		snippet: "",
		wordCount: 12,
		relationships: relatedRefs.length > 0 ? { "Related to": relatedRefs } : {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: true,
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		outgoingLinks,
		properties: {},
		hasH1: true,
		fileKind: "markdown",
	};
}

export const neighborhoodEntries = [
	buildNeighborhoodEntry({
		path: "/vault/alpha.md",
		title: "Alpha",
		relatedRefs: ["[[Beta]]"],
		outgoingLinks: ["Beta"],
		modifiedAt: 1700000003,
	}),
	buildNeighborhoodEntry({
		path: "/vault/beta.md",
		title: "Beta",
		relatedRefs: ["[[Gamma]]"],
		outgoingLinks: ["Gamma"],
		modifiedAt: 1700000002,
	}),
	buildNeighborhoodEntry({
		path: "/vault/gamma.md",
		title: "Gamma",
		relatedRefs: [],
		outgoingLinks: [],
		modifiedAt: 1700000001,
	}),
];

export const neighborhoodContent: Record<string, string> = {
	"/vault/alpha.md": "# Alpha\n\n[[Beta]]",
	"/vault/beta.md": "# Beta\n\n[[Gamma]]",
	"/vault/gamma.md": "# Gamma",
};

export function configureNeighborhoodVault() {
	mockCommandResults.list_vault = neighborhoodEntries;
	mockCommandResults.get_all_content = neighborhoodContent;
	mockCommandResults.get_note_content = ({ path }: { path: string }) =>
		new Map(Object.entries(neighborhoodContent)).get(path) ?? "";
}

export function configureNeighborhoodFavoritesVault() {
	mockCommandResults.list_vault = neighborhoodEntries.map((entry) =>
		entry.path === "/vault/alpha.md"
			? { ...entry, favorite: true, favoriteIndex: 0 }
			: entry,
	);
	mockCommandResults.get_all_content = neighborhoodContent;
	mockCommandResults.get_note_content = ({ path }: { path: string }) =>
		new Map(Object.entries(neighborhoodContent)).get(path) ?? "";
}

export function getHeaderForNoteList(noteListContainer: HTMLElement) {
	const parentElement = noteListContainer.parentElement;
	if (!parentElement) throw new Error("Expected note list parent");
	return within(parentElement).getByRole("heading", { level: 3 });
}

interface NoteListClick {
	container: HTMLElement;
	title: string;
	event?: MouseEventInit;
}

export async function clickNoteListItem({
	container,
	title,
	event,
}: NoteListClick) {
	await waitFor(() =>
		expect(within(container).getByText(title)).toBeInTheDocument(),
	);
	await act(async () => {
		fireEvent.click(within(container).getByText(title), event);
		await Promise.resolve();
	});
}

export async function enterNeighborhood(target: NoteListClick) {
	await clickNoteListItem({ ...target, event: { metaKey: true } });
}

export async function pressEscape() {
	await act(async () => {
		fireEvent.keyDown(window, { key: "Escape" });
		await Promise.resolve();
	});
}

export function resetMockCommandResults() {
	Object.assign(mockCommandResults, {
		load_vault_list: mockVaultList,
		list_vault: mockEntries,
		list_vault_folders: [],
		list_views: [],
		get_all_content: mockAllContent,
		get_modified_files: [],
		get_note_content: mockAllContent["/vault/project/test.md"] || "",
		save_note_content: null,
		reload_vault_entry: ({ path }: { path: string }) =>
			mockEntries.find((entry) => entry.path === path) ?? null,
		sync_vault_asset_scope_for_window: null,
		get_file_history: [],
		get_settings: createSettings({ auto_advance_inbox_after_organize: null }),
		is_git_repo: true,
		init_git_repo: null,
		save_settings: null,
		check_vault_exists: true,
		get_default_vault_path: expectedDefaultVaultPath,
		list_themes: [],
		get_vault_settings: { theme: null },
	});
}

export function resolveMockCommandResult(cmd: string, args?: unknown) {
	const result = Reflect.get(mockCommandResults, cmd) as unknown;
	return typeof result === "function"
		? (result as (input?: unknown) => unknown)(args)
		: (result ?? null);
}

vi.mock("./mock-tauri", () => ({
	isTauri: vi.fn(() => false),
	mockInvoke: vi.fn(async (cmd: string, args?: unknown) =>
		resolveMockCommandResult(cmd, args),
	),
	addMockEntry: vi.fn(),
	updateMockContent: vi.fn(),
	trackMockChange: vi.fn(),
}));

// Mock ai-chat utilities
vi.mock("./utils/ai-chat", async () => {
	const actual =
		await vi.importActual<typeof import("./utils/ai-chat")>("./utils/ai-chat");

	return {
		...actual,
		buildSystemPrompt: vi.fn(() => ({
			prompt: "",
			totalTokens: 0,
			truncated: false,
		})),
		checkClaudeCli: vi.fn(async () => ({ installed: false })),
		streamClaudeChat: vi.fn(async () => "mock-session"),
	};
});

vi.mock("./utils/streamAiAgent", () => ({
	streamAiAgent: vi.fn(async () => {}),
}));

vi.mock("./hooks/useUpdater", async () => {
	const actual =
		await vi.importActual<typeof import("./hooks/useUpdater")>(
			"./hooks/useUpdater",
		);

	return {
		...actual,
		useUpdater: vi.fn(() => ({
			status: { state: "idle" },
			actions: {
				checkForUpdates: vi.fn(async () => ({ kind: "up-to-date" })),
				startDownload: vi.fn(),
				openReleaseNotes: vi.fn(),
				dismiss: vi.fn(),
			},
		})),
		restartApp: vi.fn(),
	};
});

export const AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME =
	"memoria:ai-agents-onboarding-dismissed";
export const CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME =
	"memoria:claude-code-onboarding-dismissed";
export const SLOW_APP_READY_TIMEOUT_MS = 10_000;

export function render(
	ui: ReactElement,
	options?: Parameters<typeof testingLibraryRender>[1],
) {
	return testingLibraryRender(ui, {
		wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
		...options,
	});
}

export function createMockUpdaterResult(
	checkForUpdates: () => Promise<
		| { kind: "up-to-date" }
		| { kind: "available"; version: string; displayVersion: string }
		| { kind: "error"; message: string }
	> = async () => ({ kind: "up-to-date" }),
) {
	return {
		status: { state: "idle" as const },
		actions: {
			checkForUpdates,
			startDownload: vi.fn(),
			openReleaseNotes: vi.fn(),
			dismiss: vi.fn(),
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	resetMockCommandResults();
	vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) =>
		resolveMockCommandResult(cmd, args),
	);
	vi.mocked(isTauri).mockReturnValue(false);
	vi.mocked(useUpdater).mockReturnValue(createMockUpdaterResult());
	localStorage.clear();
	window.history.replaceState({}, "", "/");
	localStorage.setItem(CLAUDE_CODE_ONBOARDING_DISMISSED_STORAGE_NAME, "1");
});
