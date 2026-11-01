import type { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createMemoriaCodeBlockOptions } from "./codeBlockOptions";
import { useEditorImageRenameSync } from "./editorImageRenameSync";
import { BLOCK_CONTAINER_SELECTOR } from "./memoriaBlockNoteDom";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
import { useVaultExpressionContext } from "./VaultExpressionContext";

type CodeBlockLanguageEditor = ReturnType<typeof useCreateBlockNote>;

type CodeBlockLanguageTarget = {
	blockId: string;
	editable: boolean;
	containerElement: HTMLElement;
	language: string;
};

type LanguageSelectControl = HTMLSelectElement;

const NATIVE_LANGUAGE_CONTROL_SELECTOR =
	'.bn-block-content[data-content-type="codeBlock"] > div > select';

const LANGUAGE_OPTIONS = Object.entries(
	createMemoriaCodeBlockOptions().supportedLanguages ?? {},
).map(([id, language]) => ({ id, name: language.name }));

function languageControlTarget(
	editor: CodeBlockLanguageEditor,
	blockId: string,
	nativeControl: LanguageSelectControl,
): CodeBlockLanguageTarget | null {
	const containerElement = nativeControl.parentElement;
	if (!containerElement) return null;
	return {
		blockId,
		editable:
			editor.isEditable &&
			nativeControl.closest(".bn-editor")?.getAttribute("contenteditable") !==
				"false",
		containerElement,
		language: nativeControl.value || "text",
	};
}

function codeBlockLanguageTarget(
	editor: CodeBlockLanguageEditor,
	element: Element,
): CodeBlockLanguageTarget | null {
	if (element.tagName !== "SELECT") return null;
	const nativeControl = element as LanguageSelectControl;
	const blockId = element
		.closest(BLOCK_CONTAINER_SELECTOR)
		?.getAttribute("data-id");
	if (!blockId) return null;
	return languageControlTarget(editor, blockId, nativeControl);
}

function codeBlockLanguageTargets(
	editor: CodeBlockLanguageEditor,
): CodeBlockLanguageTarget[] {
	const root: HTMLElement | undefined = editor.domElement;
	return Array.from(
		root?.querySelectorAll(NATIVE_LANGUAGE_CONTROL_SELECTOR) ?? [],
	)
		.map((element) => codeBlockLanguageTarget(editor, element))
		.filter((target): target is CodeBlockLanguageTarget => target !== null);
}

function sameTargets(
	current: CodeBlockLanguageTarget[],
	next: CodeBlockLanguageTarget[],
): boolean {
	return (
		current.length === next.length &&
		current.every((target, index) => {
			const candidate = next.at(index);
			if (!candidate) return false;
			return (
				target.blockId === candidate.blockId &&
				target.containerElement === candidate.containerElement &&
				target.language === candidate.language &&
				target.editable === candidate.editable
			);
		})
	);
}

function useCodeBlockLanguageTargets(editor: CodeBlockLanguageEditor) {
	const [targets, setTargets] = useState<CodeBlockLanguageTarget[]>([]);

	useEffect(() => {
		let refreshFrame: number | null = null;
		const refresh = () => {
			if (refreshFrame !== null) return;
			refreshFrame = requestAnimationFrame(() => {
				refreshFrame = null;
				const nextTargets = codeBlockLanguageTargets(editor);
				setTargets((current) =>
					sameTargets(current, nextTargets) ? current : nextTargets,
				);
			});
		};
		const observer = new MutationObserver(refresh);
		observer.observe(document.body, {
			attributeFilter: ["contenteditable", "data-id", "data-content-type"],
			attributes: true,
			childList: true,
			subtree: true,
		});
		const unsubscribe = editor.onChange?.(refresh) ?? (() => {});
		refresh();

		return () => {
			if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
			observer.disconnect();
			unsubscribe();
		};
	}, [editor]);

	return targets;
}

function updateCodeBlockLanguage(
	editor: CodeBlockLanguageEditor,
	blockId: string,
	language: string,
): void {
	if (!editor.isEditable) return;

	try {
		const block = editor.getBlock(blockId);
		if (block?.type !== "codeBlock") return;
		editor.updateBlock(blockId, { props: { language } });
	} catch {
		// BlockNote can remove a block between the picker opening and selection.
	}
}

function CodeBlockLanguagePicker({
	blockId,
	editable,
	editor,
	language,
}: {
	blockId: string;
	editable: boolean;
	editor: CodeBlockLanguageEditor;
	language: string;
}) {
	return (
		<Select
			disabled={!editable}
			value={language}
			onValueChange={(nextLanguage) =>
				updateCodeBlockLanguage(editor, blockId, nextLanguage)
			}
		>
			<SelectTrigger
				size="sm"
				className="editor__code-block-language-trigger h-7 max-w-72 border-transparent bg-transparent px-2 py-0 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent position="popper" align="start">
				{LANGUAGE_OPTIONS.map(({ id, name }) => (
					<SelectItem key={id} value={id}>
						{name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function CodeBlockLanguageControls({
	editor,
}: {
	editor: CodeBlockLanguageEditor;
}) {
	const { vaultPath } = useVaultExpressionContext();
	const targets = useCodeBlockLanguageTargets(editor);
	useEditorImageRenameSync(editor, vaultPath);

	return targets.map((target) =>
		createPortal(
			<div
				className="editor__code-block-language-overlay"
				data-code-block-id={target.blockId}
			>
				<CodeBlockLanguagePicker
					blockId={target.blockId}
					editable={target.editable}
					editor={editor}
					language={target.language}
				/>
			</div>,
			target.containerElement,
			target.blockId,
		),
	);
}
