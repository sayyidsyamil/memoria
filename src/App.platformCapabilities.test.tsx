import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

// These tests cover capability gating, not sync. The real mount-time auto-sync
// pull is chained through delayed mock commands and can outlive the jsdom
// environment on a loaded machine, so run the hook with sync disabled.
vi.mock("./hooks/useAutoSync", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./hooks/useAutoSync")>();
	return {
		...actual,
		useAutoSync: (options: Parameters<typeof actual.useAutoSync>[0]) =>
			actual.useAutoSync({ ...options, enabled: false }),
	};
});

/**
 * Tests for platform capabilities detection in App.tsx (TOL-174).
 * Verifies that desktop-only features are hidden in web builds.
 */

describe("App platform capabilities", () => {
	beforeEach(() => {
		// Clean up any stubs from previous tests
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		window.localStorage.removeItem("memoria:ai-agents-onboarding-dismissed");
	});

	test("detects remote backend configuration", () => {
		// Stub window properties for remote backend
		vi.stubGlobal("MEMORIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles missing remote URL", () => {
		// Stub only MEMORIA_REMOTE_TOKEN
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles missing remote token", () => {
		// Stub only MEMORIA_REMOTE_URL
		vi.stubGlobal("MEMORIA_REMOTE_URL", "https://example.com");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles empty remote URL", () => {
		// Stub empty MEMORIA_REMOTE_URL
		vi.stubGlobal("MEMORIA_REMOTE_URL", "");
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles empty remote token", () => {
		// Stub empty MEMORIA_REMOTE_TOKEN
		vi.stubGlobal("MEMORIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles window being undefined", () => {
		// No remote config stubs - tests default mock environment
		const { container } = render(<App />);

		// App should render without crashing in mock environment
		expect(container).toBeTruthy();
	});

	test("shows the sync pill instead of the git status when a remote server is configured", async () => {
		vi.stubGlobal("MEMORIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "test-token");
		// A returning user: the remote's stand-ins answer at once (TOL-206), so the AI agents
		// card would otherwise cover the shell before the status bar is read.
		window.localStorage.setItem("memoria:ai-agents-onboarding-dismissed", "1");

		render(<App />);

		const statusBar = await screen.findByTestId("status-bar");
		expect(within(statusBar).getByTestId("status-settings")).toBeInTheDocument();
		expect(within(statusBar).getByTestId("status-sync-pill")).toHaveAttribute(
			"role",
			"status",
		);
		expect(statusBar).not.toHaveTextContent(/changes|commit|not synced/i);
	});

	test("keeps the quiet status bar without a remote server", async () => {
		render(<App />);

		// Startup may replace the temporary footer. Query the live shell rather
		// than keeping an element detached by the vault scan.
		await waitFor(() => {
			const statusBar = screen.getByTestId("status-bar");
			expect(within(statusBar).getByTestId("status-settings")).toBeInTheDocument();
			expect(within(statusBar).queryByTestId("status-sync-pill")).not.toBeInTheDocument();
			expect(statusBar).not.toHaveTextContent(/changes|commit|contribute/i);
		});
	});
});
