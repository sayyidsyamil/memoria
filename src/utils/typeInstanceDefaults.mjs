const EXCLUDED_KEYS = new Set([
	"type",
	"isa",
	"title",
	"aliases",
	"archived",
	"owner",
	"cadence",
	"color",
	"icon",
	"order",
	"sidebarlabel",
	"template",
	"sort",
	"view",
	"visible",
	"organized",
	"favorite",
	"favoriteindex",
	"created",
	"modified",
	"listpropertiesdisplay",
	"notelistproperties",
]);

export function canonicalTypeInstanceKey(key) {
	return compactKey(key);
}

export function isTypeInstanceDefault(
	key,
	value,
	canonicalizeKey = canonicalTypeInstanceKey,
) {
	const canonicalKey = compactKey(canonicalizeKey(key));
	if (key.startsWith("_")) return false;
	if (canonicalKey.startsWith("_")) return false;
	if (EXCLUDED_KEYS.has(canonicalKey)) return false;
	if (Array.isArray(value)) {
		if (value.length === 0) return false;
		return value.every(isValuedScalar);
	}
	return isValuedScalar(value);
}

export function selectTypeInstanceDefaults(
	entries,
	canonicalizeKey = canonicalTypeInstanceKey,
) {
	const seen = new Set();
	return entries.filter(([key, value]) => {
		if (!isTypeInstanceDefault(key, value, canonicalizeKey)) return false;
		const canonicalKey = compactKey(canonicalizeKey(key));
		if (seen.has(canonicalKey)) return false;
		seen.add(canonicalKey);
		return true;
	});
}

function isValuedScalar(value) {
	if (typeof value === "string") return value.trim().length > 0;
	return typeof value === "number" || typeof value === "boolean";
}

function compactKey(key) {
	return key.toLowerCase().replace(/[\s_-]/g, "");
}
