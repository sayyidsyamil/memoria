// Budgets for the big-vault web bench (TOL-225, bench/big-vault.spec.ts). docs/PERFORMANCE.md
// records what each number measures and how it was calibrated: change both together.

export interface BigVaultMeasurements {
	coldOpenMs: number;
	coldMaxLongTaskMs: number;
	warmOpenMs: number;
	warmMaxLongTaskMs: number;
	warmBlockingMs: number;
	noteOpenMs: number;
	typingP50Ms: number;
	typingP95Ms: number;
	typingMaxLongTaskMs: number;
	searchMs: number;
	heapMb: number;
}

export type BigVaultMetric = keyof BigVaultMeasurements;

interface Budget {
	label: string;
	unit: "ms" | "MB";
	max: number;
}

export const BIG_VAULT_BUDGETS: Record<BigVaultMetric, Budget> = {
	coldOpenMs: { label: "Cold open: note list painted", unit: "ms", max: 2500 },
	coldMaxLongTaskMs: { label: "Cold open: longest task", unit: "ms", max: 600 },
	warmOpenMs: {
		label: "Warm open: cached note list painted, median of 3",
		unit: "ms",
		max: 1000,
	},
	warmMaxLongTaskMs: {
		label: "Warm open + background reload: longest task",
		unit: "ms",
		max: 400,
	},
	warmBlockingMs: {
		label: "Warm open + background reload: total blocking time",
		unit: "ms",
		max: 600,
	},
	noteOpenMs: {
		label: "Note open: click to body on screen",
		unit: "ms",
		max: 2000,
	},
	typingP50Ms: {
		label: "Typing: keystroke to next frame, median",
		unit: "ms",
		max: 50,
	},
	typingP95Ms: {
		label: "Typing: keystroke to next frame, p95",
		unit: "ms",
		max: 100,
	},
	typingMaxLongTaskMs: { label: "Typing: longest task", unit: "ms", max: 200 },
	searchMs: {
		label: "Search: query to matching result (300 ms debounce included)",
		unit: "ms",
		max: 1500,
	},
	heapMb: { label: "Memory: JS heap after GC, warm", unit: "MB", max: 80 },
};

export interface BudgetResult extends Budget {
	metric: BigVaultMetric;
	value: number;
	withinBudget: boolean;
}

/** Every budget with its measurement; a missing (non-finite) measurement is over budget. */
export function evaluateBudgets(
	measurements: BigVaultMeasurements,
): BudgetResult[] {
	return (Object.keys(BIG_VAULT_BUDGETS) as BigVaultMetric[]).map((metric) => {
		const value = measurements[metric];
		const budget = BIG_VAULT_BUDGETS[metric];
		return {
			...budget,
			metric,
			value,
			withinBudget: Number.isFinite(value) && value <= budget.max,
		};
	});
}

function formatRow(result: BudgetResult): string {
	const verdict = result.withinBudget ? "ok" : "OVER BUDGET";
	return `| ${result.label} | ${Math.round(result.value)} ${result.unit} | ${result.max} ${result.unit} | ${verdict} |`;
}

/** A Markdown table of every measurement against its budget, for the job log and artifact. */
export function formatBenchReport(
	results: BudgetResult[],
	noteCount: number,
): string {
	return [
		`### Big-vault web bench (${noteCount} notes)`,
		"",
		"| Metric | Measured | Budget | Result |",
		"| --- | --- | --- | --- |",
		...results.map(formatRow),
	].join("\n");
}
