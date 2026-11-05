import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BIG_VAULT_BUDGETS,
	type BigVaultMeasurements,
	evaluateBudgets,
	formatBenchReport,
} from "./bigVaultBudgets.ts";

function withinEveryBudget(): BigVaultMeasurements {
	const entries = Object.entries(BIG_VAULT_BUDGETS).map(([metric, budget]) => [
		metric,
		budget.max,
	]);
	return Object.fromEntries(entries) as unknown as BigVaultMeasurements;
}

describe("big-vault bench budgets", () => {
	it("passes a measurement equal to its budget", () => {
		const results = evaluateBudgets(withinEveryBudget());
		assert.equal(results.length, Object.keys(BIG_VAULT_BUDGETS).length);
		assert.ok(results.every((result) => result.withinBudget));
	});

	it("fails only the metric over its budget", () => {
		const measurements = {
			...withinEveryBudget(),
			searchMs: BIG_VAULT_BUDGETS.searchMs.max + 1,
		};
		const failed = evaluateBudgets(measurements).filter(
			(result) => !result.withinBudget,
		);
		assert.deepEqual(
			failed.map((result) => result.metric),
			["searchMs"],
		);
	});

	it("fails a metric that was not measured", () => {
		const measurements = { ...withinEveryBudget(), heapMb: Number.NaN };
		const failed = evaluateBudgets(measurements).filter(
			(result) => !result.withinBudget,
		);
		assert.deepEqual(
			failed.map((result) => result.metric),
			["heapMb"],
		);
	});

	it("reports every metric with its budget and verdict", () => {
		const measurements = { ...withinEveryBudget(), warmOpenMs: 1234.4 };
		const report = formatBenchReport(evaluateBudgets(measurements), 6000);
		assert.match(report, /6000 notes/);
		assert.match(
			report,
			/\| Warm open: cached note list painted, median of 3 \| 1234 ms \| 1000 ms \| OVER BUDGET \|/,
		);
		const okRows = report.split("\n").filter((line) => line.endsWith("| ok |"));
		assert.equal(okRows.length, Object.keys(BIG_VAULT_BUDGETS).length - 1);
	});
});
