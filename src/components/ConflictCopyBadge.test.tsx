import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictCopyBadge } from "./ConflictCopyBadge";

const COPY = "notes/plan (conflict 2026-10-24 2210).md";

function connectToRemote() {
	vi.stubGlobal("MEMORIA_REMOTE_URL", "https://memoria.example");
	vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "token-not-a-secret");
}

describe("ConflictCopyBadge", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("marks a conflict copy in the web build", () => {
		connectToRemote();
		render(<ConflictCopyBadge path={COPY} />);
		expect(screen.getByTestId("conflict-copy-badge")).toHaveTextContent(
			"Conflict copy",
		);
	});

	it("marks nothing for an ordinary note", () => {
		connectToRemote();
		render(<ConflictCopyBadge path="notes/plan.md" />);
		expect(screen.queryByTestId("conflict-copy-badge")).toBeNull();
	});

	it("leaves the desktop note list unchanged", () => {
		render(<ConflictCopyBadge path={COPY} />);
		expect(screen.queryByTestId("conflict-copy-badge")).toBeNull();
	});
});
