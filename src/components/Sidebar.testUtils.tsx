import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SidebarSelection, VaultEntry } from "../types";
import { Sidebar } from "./Sidebar";

const displayDefaults: Pick<
	VaultEntry,
	| "view"
	| "visible"
	| "organized"
	| "favorite"
	| "favoriteIndex"
	| "listPropertiesDisplay"
	| "hasH1"
> = {
	view: null,
	visible: true,
	organized: false,
	favorite: false,
	favoriteIndex: null,
	listPropertiesDisplay: [],
	hasH1: true,
};

export const mockEntries: VaultEntry[] = [
	{
		path: "/vault/project/build-app.md",
		filename: "build-app.md",
		title: "Build Laputa App",
		isA: "Project",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: "Active",

		archived: false,
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
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/responsibility/grow-newsletter.md",
		filename: "grow-newsletter.md",
		title: "Grow Newsletter",
		isA: "Responsibility",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: "Active",

		archived: false,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 512,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/experiment/stock-screener.md",
		filename: "stock-screener.md",
		title: "Stock Screener",
		isA: "Experiment",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: "Active",

		archived: false,
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
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/procedure/weekly-essays.md",
		filename: "weekly-essays.md",
		title: "Write Weekly Essays",
		isA: "Procedure",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: "Active",

		archived: false,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 128,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/topic/software-development.md",
		filename: "software-development.md",
		title: "Software Development",
		isA: "Topic",
		aliases: ["Dev", "Coding"],
		belongsTo: [],
		relatedTo: [],
		status: null,

		archived: false,
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
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/topic/trading.md",
		filename: "trading.md",
		title: "Trading",
		isA: "Topic",
		aliases: ["Algorithmic Trading"],
		belongsTo: [],
		relatedTo: [],
		status: null,

		archived: false,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 180,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/person/alice.md",
		filename: "alice.md",
		title: "Alice",
		isA: "Person",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: null,

		archived: false,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 100,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		outgoingLinks: [],
		properties: {},
	},
	{
		path: "/vault/event/kickoff.md",
		filename: "kickoff.md",
		title: "Kickoff Meeting",
		isA: "Event",
		aliases: [],
		belongsTo: [],
		relatedTo: [],
		status: null,

		archived: false,
		modifiedAt: 1700000000,
		createdAt: null,
		fileSize: 200,
		snippet: "",
		wordCount: 0,
		relationships: {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		outgoingLinks: [],
		properties: {},
	},
].map((entry) => ({ ...displayDefaults, ...entry }));

export const defaultSelection: SidebarSelection = {
	kind: "filter",
	filter: "all",
};

export function requireElement<T>(element: T | null | undefined): T {
	if (element == null) throw new Error("Expected sidebar element");
	return element;
}

export function buildSidebarEntry(overrides: Partial<VaultEntry>): VaultEntry {
	return { ...mockEntries[0], ...overrides };
}

export function renderSidebar(
	props: Partial<ComponentProps<typeof Sidebar>> = {},
) {
	return render(
		<Sidebar
			entries={mockEntries}
			selection={defaultSelection}
			onSelect={() => {}}
			{...props}
		/>,
	);
}
