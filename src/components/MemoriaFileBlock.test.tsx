import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoriaFileBlock } from "./MemoriaFileBlock";

vi.mock("@blocknote/react", () => ({
	FileBlockWrapper: ({
		children,
		block,
	}: {
		children?: React.ReactNode;
		block: { props: { name: string } };
	}) => <div>{children ?? block.props.name}</div>,
	useResolveUrl: (url: string) => ({
		loadingState: "loaded",
		downloadUrl: url,
	}),
}));
vi.mock("./PdfFilePreview", () => ({
	PdfFilePreview: ({
		source,
		onError,
	}: {
		source: string;
		onError: () => void;
	}) => (
		<button
			type="button"
			data-testid="pdf"
			data-source={source}
			onClick={onError}
		/>
	),
}));

function fileProps(url: string) {
	return {
		block: {
			id: "file",
			props: {
				url,
				name: "The Beatles (音楽).PDF",
				caption: "",
				backgroundColor: "default",
			},
			type: "file",
			content: undefined,
			children: [],
		},
		editor: {},
	} as Parameters<typeof MemoriaFileBlock>[0];
}

describe("inline imported files", () => {
	it("renders an imported PDF with the shared PDF renderer", () => {
		const source =
			"asset://localhost/%2Fvault%2FThe%20Beatles%20(%E9%9F%B3%E6%A5%BD).PDF";
		render(<MemoriaFileBlock {...fileProps(source)} />);
		expect(screen.getByTestId("pdf")).toHaveAttribute("data-source", source);
	});

	it("keeps ordinary attachments as filename controls", () => {
		const props = fileProps("asset://localhost/archive.zip");
		props.block.props.name = "archive.zip";
		render(<MemoriaFileBlock {...props} />);
		expect(screen.queryByTestId("pdf")).not.toBeInTheDocument();
		expect(screen.getByText("archive.zip")).toBeInTheDocument();
	});

	it("falls back to the existing filename control when PDF rendering fails", () => {
		render(<MemoriaFileBlock {...fileProps("asset://localhost/report.pdf")} />);
		fireEvent.click(screen.getByTestId("pdf"));
		expect(screen.queryByTestId("pdf")).not.toBeInTheDocument();
		expect(screen.getByText("The Beatles (音楽).PDF")).toBeInTheDocument();
	});
});
