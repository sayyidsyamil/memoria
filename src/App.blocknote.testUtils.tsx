import type { ReactNode } from "react";
import { vi } from "vitest";

// Mock BlockNote components (they need DOM APIs not available in jsdom)
vi.mock("@blocknote/core", () => ({
	audioParse: vi.fn(() => undefined),
	createAudioBlockConfig: vi.fn(() => ({})),
	createFileBlockConfig: vi.fn(() => ({})),
	createFileBlockSpec: vi.fn(() => ({
		implementation: { toExternalHTML: () => null },
	})),
	fileParse: vi.fn(() => undefined),
	BlockNoteSchema: { create: () => ({ extend: () => ({}) }) },
	createCodeBlockSpec: vi.fn(() => ({ implementation: { render: vi.fn() } })),
	createExtension: (factory: unknown) => () => factory,
	createStyleSpec: vi.fn(() => ({})),
	createVideoBlockConfig: vi.fn(() => ({})),
	defaultInlineContentSpecs: {},
	filterSuggestionItems: vi.fn(() => []),
	videoParse: vi.fn(() => undefined),
}));

vi.mock("@blocknote/code-block", () => ({ codeBlockOptions: {} }));

vi.mock("@blocknote/core/extensions", () => ({
	filterSuggestionItems: vi.fn(() => []),
}));

vi.mock("@blocknote/react", () => {
	const blockNoteEditor = {
		tryParseMarkdownToBlocks: async () => [],
		replaceBlocks: () => {},
		document: [],
		insertInlineContent: () => {},
		setTextCursorPosition: () => {},
		focus: () => {},
		domElement: null,
		onChange: () => () => {},
		onMount: (cb: () => void) => {
			cb();
			return () => {};
		},
	};

	return {
		AudioBlock: () => null,
		AudioToExternalHTML: () => null,
		createReactBlockSpec: () => () => ({}),
		createReactInlineContentSpec: () => ({ render: () => null }),
		VideoBlock: () => null,
		VideoToExternalHTML: () => null,
		BlockNoteViewRaw: ({
			children,
			editable,
		}: {
			children?: ReactNode;
			editable?: boolean;
		}) => (
			<div
				data-testid="blocknote-view"
				data-editable={editable !== false ? "true" : "false"}
			>
				<div
					contentEditable={editable !== false}
					suppressContentEditableWarning
					data-testid="mock-editor"
				>
					mock editor
				</div>
				{children}
			</div>
		),
		LinkToolbar: ({ children }: { children?: ReactNode }) => <>{children}</>,
		ComponentsContext: {
			Provider: ({ children }: { children?: ReactNode }) => <>{children}</>,
		},
		useCreateBlockNote: () => blockNoteEditor,
		useBlockNoteEditor: () => blockNoteEditor,
		LinkToolbarController: () => null,
		EditLinkButton: () => null,
		DeleteLinkButton: () => null,
		SideMenuController: () => null,
		SuggestionMenuController: () => null,
		GridSuggestionMenuController: () => null,
		useComponentsContext: () => ({
			LinkToolbar: {
				Button: ({
					children,
					label,
					onClick,
				}: {
					children?: ReactNode;
					label?: string;
					onClick?: () => void;
				}) => (
					<button onClick={onClick} type="button">
						{label}
						{children}
					</button>
				),
			},
		}),
		useDictionary: () => ({
			link_toolbar: {
				open: { tooltip: "Open in a new tab" },
			},
		}),
	};
});

vi.mock("@blocknote/mantine", () => ({
	components: {},
	BlockNoteView: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="blocknote-view">{children}</div>
	),
}));

vi.mock("@blocknote/mantine/style.css", () => ({}));

vi.mock("./components/memoriaEditorFormatting", () => ({
	MemoriaFormattingToolbar: () => null,
	MemoriaFormattingToolbarController: () => null,
}));
