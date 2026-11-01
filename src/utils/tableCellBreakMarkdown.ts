import { advanceMarkdownFence, type MarkdownFence } from "./markdownFences";
import { isTableBodyLine, isTableStart } from "./markdownTables";

const CELL_BREAK_TOKEN = "\uE000MEMORIACELLBREAK\uE001";
const INLINE_CODE_OR_BREAK = /(`+)[^`]*?\1|\\<|<br\s*\/?>/giu;

function protectCellBreaks(line: string): string {
	return line.replace(INLINE_CODE_OR_BREAK, (token) =>
		/^<br/iu.test(token) ? CELL_BREAK_TOKEN : token,
	);
}

interface TableScanState {
	fence: MarkdownFence | null;
	inTable: boolean;
}

interface TableLineContext {
	line: string;
	nextLine: string;
	state: TableScanState;
}

function processTableLine({ line, nextLine, state }: TableLineContext): string {
	if (/^\r?\n$/u.test(line)) return line;
	const nextFence = advanceMarkdownFence(line, state.fence);
	const fenced = state.fence !== null || nextFence !== null;
	state.fence = nextFence;
	if (fenced) {
		state.inTable = false;
		return line;
	}
	const tableStart = isTableStart({ line, nextLine });
	state.inTable = tableStart || (state.inTable && isTableBodyLine(line));
	return state.inTable ? protectCellBreaks(line) : line;
}

/** Keep table breaks out of BlockNote's HTML-stripping Markdown parser. */
export function preProcessTableCellBreaks(markdown: string): string {
	const lines = markdown.split(/(\r?\n)/u);
	const state: TableScanState = { fence: null, inTable: false };
	return lines
		.map((line, index) =>
			processTableLine({ line, nextLine: lines.at(index + 2) ?? "", state }),
		)
		.join("");
}

function restoreArray(values: unknown[]): unknown[] {
	let changed = false;
	const restored = values.map((value) => {
		const next = restoreCellBreakValue(value);
		changed ||= next !== value;
		return next;
	});
	return changed ? restored : values;
}

function restoreObject(
	value: Record<string, unknown>,
): Record<string, unknown> {
	let changed = false;
	const restored = Object.fromEntries(
		Object.entries(value).map(([key, item]) => {
			const next = restoreCellBreakValue(item);
			changed ||= next !== item;
			return [key, next];
		}),
	);
	return changed ? restored : value;
}

function restoreCellBreakValue(value: unknown): unknown {
	if (typeof value === "string")
		return value.replaceAll(CELL_BREAK_TOKEN, "\n");
	if (Array.isArray(value)) return restoreArray(value);
	if (typeof value !== "object" || value === null) return value;
	return restoreObject(value as Record<string, unknown>);
}

export function injectTableCellBreaks(blocks: unknown[]): unknown[] {
	return restoreArray(blocks);
}
