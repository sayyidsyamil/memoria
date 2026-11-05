import {
	createFileBlockConfig,
	createFileBlockSpec,
	fileParse,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { MemoriaFileBlock } from "./MemoriaFileBlock";

const fileBlock = createReactBlockSpec(createFileBlockConfig, {
	meta: { fileBlockAccept: ["*/*"] },
	parse: fileParse(),
	render: MemoriaFileBlock,
})();

// Preserve BlockNote's durable HTML/Markdown export; canvas is only a view.
export const memoriaFileBlock = {
	...fileBlock,
	implementation: {
		...fileBlock.implementation,
		toExternalHTML: createFileBlockSpec().implementation.toExternalHTML,
	},
};
