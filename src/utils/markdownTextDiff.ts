type TextOffset = number;
type EditDistance = number;
type Diagonal = number;
type Frontier = number[];

export interface MarkdownTextEdit {
	from: number;
	to: number;
	insert: string;
}

interface TextPair {
	before: string;
	after: string;
}

interface BisectState extends TextPair {
	offset: number;
	delta: number;
	forward: number[];
	reverse: number[];
}

interface SplitPoint {
	x: number;
	y: number;
}

function commonBoundary(pair: TextPair, reverse: boolean): number {
	const limit = Math.min(pair.before.length, pair.after.length);
	let length = 0;
	while (
		length < limit &&
		frontierCharactersMatch(pair, length, length, reverse)
	)
		length++;
	return length;
}

function frontierCharactersMatch(
	{ before, after }: TextPair,
	x: TextOffset,
	y: TextOffset,
	reverse: boolean,
): boolean {
	const beforeIndex = reverse ? before.length - x - 1 : x;
	const afterIndex = reverse ? after.length - y - 1 : y;
	const character = before.charAt(beforeIndex);
	return character !== "" && character === after.charAt(afterIndex);
}

function nextX(
	frontier: Frontier,
	index: TextOffset,
	diagonal: Diagonal,
	distance: EditDistance,
): number {
	if (diagonal === -distance) return frontier[index + 1];
	if (diagonal === distance) return frontier[index - 1] + 1;
	return frontier[index - 1] < frontier[index + 1]
		? frontier[index + 1]
		: frontier[index - 1] + 1;
}

function advanceFrontier(
	state: BisectState,
	diagonal: Diagonal,
	distance: EditDistance,
	reverse: boolean,
): SplitPoint {
	const frontier = reverse ? state.reverse : state.forward;
	let x = nextX(frontier, state.offset + diagonal, diagonal, distance);
	let y = x - diagonal;
	while (frontierCharactersMatch(state, x, y, reverse)) {
		x++;
		y++;
	}
	frontier[state.offset + diagonal] = x;
	return { x, y };
}

function forwardOverlap(
	state: BisectState,
	diagonal: Diagonal,
	point: SplitPoint,
): SplitPoint | null {
	if (state.delta % 2 === 0) return null;
	const opposite = state.reverse[state.offset + state.delta - diagonal];
	if (opposite === undefined || opposite < 0) return null;
	return point.x >= state.before.length - opposite ? point : null;
}

function reverseOverlap(
	state: BisectState,
	diagonal: Diagonal,
	point: SplitPoint,
): SplitPoint | null {
	if (state.delta % 2 !== 0) return null;
	const forwardDiagonal = state.delta - diagonal;
	const x = state.forward[state.offset + forwardDiagonal];
	if (x === undefined || x < 0) return null;
	return x >= state.before.length - point.x
		? { x, y: x - forwardDiagonal }
		: null;
}

function findSplit({ before, after }: TextPair): SplitPoint | null {
	const limit = Math.ceil((before.length + after.length) / 2);
	const offset = limit + 1;
	const state: BisectState = {
		before,
		after,
		offset,
		delta: before.length - after.length,
		forward: Array.from({ length: 2 * limit + 3 }, () => -1),
		reverse: Array.from({ length: 2 * limit + 3 }, () => -1),
	};
	state.forward[offset + 1] = 0;
	state.reverse[offset + 1] = 0;
	for (let distance = 0; distance <= limit; distance++) {
		const point = findDistanceSplit(state, distance);
		if (point) return point;
	}
	return null;
}

function findDirectionalSplit(
	state: BisectState,
	distance: EditDistance,
	reverse: boolean,
): SplitPoint | null {
	const overlap = reverse ? reverseOverlap : forwardOverlap;
	for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
		const point = overlap(
			state,
			diagonal,
			advanceFrontier(state, diagonal, distance, reverse),
		);
		if (point) return point;
	}
	return null;
}

function findDistanceSplit(
	state: BisectState,
	distance: EditDistance,
): SplitPoint | null {
	return (
		findDirectionalSplit(state, distance, false) ??
		findDirectionalSplit(state, distance, true)
	);
}

function splitEdits(
	{ before, after }: TextPair,
	offset: TextOffset,
): MarkdownTextEdit[] {
	if (!before || !after)
		return [{ from: offset, to: offset + before.length, insert: after }];
	const point = findSplit({ before, after });
	if (!point) {
		return [{ from: offset, to: offset + before.length, insert: after }];
	}
	if (point.x === 0 && point.y === 0) {
		return [{ from: offset, to: offset + before.length, insert: after }];
	}
	if (point.x === before.length && point.y === after.length) {
		return [{ from: offset, to: offset + before.length, insert: after }];
	}
	return [
		...textEdits(
			{ before: before.slice(0, point.x), after: after.slice(0, point.y) },
			offset,
		),
		...textEdits(
			{ before: before.slice(point.x), after: after.slice(point.y) },
			offset + point.x,
		),
	];
}

function textEdits(
	{ before, after }: TextPair,
	offset: TextOffset,
): MarkdownTextEdit[] {
	if (before === after) return [];
	const prefix = commonBoundary({ before, after }, false);
	const left = before.slice(prefix);
	const right = after.slice(prefix);
	const suffix = commonBoundary({ before: left, after: right }, true);
	return splitEdits(
		{
			before: left.slice(0, left.length - suffix),
			after: right.slice(0, right.length - suffix),
		},
		offset + prefix,
	);
}

export function markdownTextEdits(
	before: string,
	after: string,
): MarkdownTextEdit[] {
	return mergeEdits(textEdits({ before, after }, 0));
}

function mergeEdits(edits: MarkdownTextEdit[]): MarkdownTextEdit[] {
	const result: MarkdownTextEdit[] = [];
	for (const edit of edits) {
		const previous = result.at(-1);
		if (previous?.to === edit.from) {
			previous.to = edit.to;
			previous.insert += edit.insert;
		} else {
			result.push({ ...edit });
		}
	}
	return result;
}
