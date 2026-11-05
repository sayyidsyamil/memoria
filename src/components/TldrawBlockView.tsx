import { lazy, Suspense } from "react";
import {
	type TldrawBlockMutationEditor,
	type TldrawBlockProps,
	updateTldrawBlockPropsSafely,
} from "./tldrawBlockProps";

const TldrawWhiteboard = lazy(() =>
	import("./TldrawWhiteboard").then((module) => ({
		default: module.TldrawWhiteboard,
	})),
);
interface TldrawBlockViewProps {
	block: { id: string; props: TldrawBlockProps };
	editor: TldrawBlockMutationEditor;
}
export function TldrawBlockView(props: TldrawBlockViewProps) {
	return (
		<Suspense
			fallback={
				<div className="tldraw-whiteboard tldraw-whiteboard--loading" />
			}
		>
			<TldrawWhiteboard
				boardId={props.block.props.boardId}
				height={props.block.props.height}
				snapshot={props.block.props.snapshot}
				width={props.block.props.width}
				onSnapshotChange={(snapshot) => {
					updateTldrawBlockPropsSafely({
						blockId: props.block.id,
						editor: props.editor,
						nextProps: (currentProps) => ({
							...currentProps,
							snapshot,
						}),
					});
				}}
				onSizeChange={(size) => {
					updateTldrawBlockPropsSafely({
						blockId: props.block.id,
						editor: props.editor,
						nextProps: (currentProps) => ({
							...currentProps,
							height: size.height,
							width: size.width,
						}),
					});
				}}
			/>
		</Suspense>
	);
}
