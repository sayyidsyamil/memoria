import type { VaultOption } from "../components/status-bar/types";
import type { VaultEntry } from "../types";
import { slugifyNoteStem as slugify } from "../utils/noteSlug";
import { resolveEntry } from "../utils/wikilink";
import {
	labelFromWorkspacePath,
	workspaceIdentityFromVault,
} from "../utils/workspaces";

export interface NewEntryParams {
	path: string;
	slug: string;
	title: string;
	type: string;
	status: string | null;
}

export function buildNewEntry({
	path,
	slug,
	title,
	type,
	status,
}: NewEntryParams): VaultEntry {
	const now = Math.floor(Date.now() / 1000);
	return {
		path,
		filename: `${slug}.md`,
		title,
		isA: type,
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status,
		archived: false,
		modifiedAt: now,
		createdAt: now,
		fileSize: 0,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		outgoingLinks: [],
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: null,
		properties: {},
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		hasH1: false,
	};
}

export function workspaceForVaultPath(
	vaultPath: string,
	vaults: readonly VaultOption[] = [],
	defaultWorkspacePath?: string | null,
) {
	const configuredVault = vaults.find((vault) => vault.path === vaultPath);
	return workspaceIdentityFromVault(
		configuredVault ?? {
			label: labelFromWorkspacePath(vaultPath),
			path: vaultPath,
			available: true,
			mounted: true,
		},
		{ defaultWorkspacePath },
	);
}

export function resolveCreationVaultPath(
	vaultPath: string,
	defaultWorkspacePath?: string | null,
	vaults: readonly VaultOption[] = [],
): string {
	if (!defaultWorkspacePath) return vaultPath;
	const defaultVault = vaults.find(
		(vault) => vault.path === defaultWorkspacePath,
	);
	if (!defaultVault) return defaultWorkspacePath;
	return defaultVault.available === false || defaultVault.mounted === false
		? vaultPath
		: defaultVault.path;
}

export { slugify };

/** Convert a filename slug to a human-readable title (hyphens → spaces, title case). */
export function slug_to_title(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/** Generate a unique "Untitled <type>" name by checking existing entries and pending names. */
export interface UntitledNameParams {
	entries: VaultEntry[];
	type: string;
	pendingTitles?: Set<string>;
}

export function generateUntitledName({
	entries,
	type,
	pendingTitles,
}: UntitledNameParams): string {
	const baseName = `Untitled ${type.toLowerCase()}`;
	const existingTitles = new Set(entries.map((e) => e.title));
	if (pendingTitles) {
		for (const title of pendingTitles) {
			existingTitles.add(title);
		}
	}
	let title = baseName;
	let counter = 2;
	while (existingTitles.has(title)) {
		title = `${baseName} ${counter}`;
		counter++;
	}
	return title;
}

export interface EntryMatchParams {
	entry: VaultEntry;
	target: string;
}

export function entryMatchesTarget({
	entry,
	target,
}: EntryMatchParams): boolean {
	return resolveEntry([entry], target) === entry;
}

/** Look up the template for a given type from the type entry. */
export interface TemplateLookupParams {
	entries: VaultEntry[];
	typeName: string;
}

export function resolveTemplate({
	entries,
	typeName,
}: TemplateLookupParams): string | null {
	const typeEntry = entries.find(
		(entry) => entry.isA === "Type" && entry.title === typeName,
	);
	return typeEntry?.template ?? null;
}
