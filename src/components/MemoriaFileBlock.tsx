import { FileBlockWrapper, useResolveUrl } from "@blocknote/react";
import { type ComponentProps, useCallback, useState } from "react";
import { trackFilePreviewFailed } from "../lib/productAnalytics";
import { PdfFilePreview } from "./PdfFilePreview";

type FileProps = ComponentProps<typeof FileBlockWrapper>;

function InlinePdfPreview(props: FileProps) {
	const resolved = useResolveUrl(props.block.props.url);
	const [failed, setFailed] = useState(false);
	const onError = useCallback(() => {
		setFailed(true);
		trackFilePreviewFailed("pdf");
	}, []);
	const fallback = <FileBlockWrapper {...props} />;
	if (failed || resolved.loadingState !== "loaded") return fallback;

	return (
		<FileBlockWrapper {...props} style={{ width: "100%" }}>
			<div contentEditable={false} className="h-[480px] w-full">
				<PdfFilePreview
					key={resolved.downloadUrl}
					fallback={fallback}
					onError={onError}
					source={resolved.downloadUrl}
					title={props.block.props.name || props.block.props.url}
				/>
			</div>
		</FileBlockWrapper>
	);
}

export function MemoriaFileBlock(props: FileProps) {
	const source = props.block.props.url.split(/[?#]/u)[0];
	if (!/\.pdf$/iu.test(source)) return <FileBlockWrapper {...props} />;
	return <InlinePdfPreview key={props.block.props.url} {...props} />;
}
