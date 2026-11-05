import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../test-utils/noteListTestUtils";
import { ActionTooltip } from "../ui/action-tooltip";
import { TooltipProvider } from "../ui/tooltip";
import { ListView } from "./NoteListViews";

vi.unmock("react-virtuoso");

function EditableList() {
	const [title, setTitle] = useState("Untitled");
	return (
		<TooltipProvider>
			<ActionTooltip copy={{ label: title }}>
				<span>
					<button
						type="button"
						onClick={() => setTitle((value) => `${value} edited`)}
					>
						Edit title
					</button>
				</span>
			</ActionTooltip>
			<VirtuosoMockContext.Provider
				value={{ viewportHeight: 600, itemHeight: 40 }}
			>
				<ListView
					searched={[makeEntry({ title })]}
					query=""
					renderItem={(entry) => <span>{entry.title}</span>}
				/>
			</VirtuosoMockContext.Provider>
		</TooltipProvider>
	);
}

describe("note list update stability", () => {
	it("settles after repeated title updates with the real virtualizer and sidebar tooltip", () => {
		render(
			<StrictMode>
				<EditableList />
			</StrictMode>,
		);
		for (let index = 0; index < 60; index++)
			fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
		expect(
			screen.getByText(`Untitled${" edited".repeat(60)}`),
		).toBeInTheDocument();
	});
});
