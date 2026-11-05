export type InstanceDefaultValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>;

export function canonicalTypeInstanceKey(key: string): string;
export function isTypeInstanceDefault(
	key: string,
	value: unknown,
	canonicalizeKey?: (key: string) => string,
): value is InstanceDefaultValue;
export function selectTypeInstanceDefaults<T extends [string, unknown]>(
	entries: T[],
	canonicalizeKey?: (key: string) => string,
): T[];
