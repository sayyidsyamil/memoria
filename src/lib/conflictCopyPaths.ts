/** `notes/a (conflict 2026-10-10 1903).md`, or `… 1903 2).md`: the name the Memoria server gives a conflict copy. */
const MARKER = " (conflict ";
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME = /^\d{4}$/u;
const COUNTER = /^\d+$/u;

/** The file name of a path, for telling people which file holds a conflict copy. */
export function fileNameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function withoutExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function matches(pattern: RegExp, part: string | undefined): boolean {
	return part !== undefined && pattern.test(part);
}

/** `2026-10-10 1903` or `2026-10-10 1903 2`. */
function isConflictStamp(stamp: string): boolean {
	const [date, time, counter, ...rest] = stamp.split(" ");
	if (rest.length > 0) return false;
	if (!matches(DATE, date) || !matches(TIME, time)) return false;
	return counter === undefined || COUNTER.test(counter);
}

export function isConflictCopyPath(path: string): boolean {
	const stem = withoutExtension(fileNameOf(path));
	const marker = stem.lastIndexOf(MARKER);
	if (marker < 0 || !stem.endsWith(")")) return false;
	return isConflictStamp(stem.slice(marker + MARKER.length, -1));
}
