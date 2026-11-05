export function splitTableRow(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

	const cells: string[] = [];
	let cell = "";
	for (let index = 0; index < trimmed.length; index += 1) {
		const char = trimmed.charAt(index);
		if (char === "\\" && trimmed.charAt(index + 1) === "|") {
			cell += "|";
			index += 1;
			continue;
		}
		if (char === "|") {
			cells.push(cell.trim());
			cell = "";
			continue;
		}
		cell += char;
	}
	cells.push(cell.trim());
	return cells;
}

export function isTableSeparator(line: string): boolean {
	const cells = splitTableRow(line);
	return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

export function isTableStart({
	line,
	nextLine,
}: {
	line: string;
	nextLine: string;
}): boolean {
	return line.includes("|") && isTableSeparator(nextLine);
}

export function isTableBodyLine(line: string): boolean {
	return line.includes("|") && line.trim() !== "";
}
