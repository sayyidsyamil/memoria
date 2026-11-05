import { withWorkspaceRead } from "./git/workspaceOperationQueue";
import { persistWorkspaceOperations } from "./git/workspaceWriteQueue";
import {
	buildLocalVaultWorkspaceSnapshot,
	type LocalVaultFile,
} from "./localVaultSnapshot";
import type { MobileWorkspaceWrite } from "./mobileWorkspaceEditing";
import type {
	MobileNote,
	MobileVaultConfig,
	MobileWorkspaceSnapshot,
} from "./mobileWorkspaceModel";
import { takePreparedWorkspaceSnapshot } from "./preparedWorkspaceSnapshot";
import type {
	ReadOnlyWorkspaceRepository,
	ReadOnlyWorkspaceRequest,
} from "./readOnlyWorkspaceRepository";
import { trackWorkspacePathWrites } from "./workspacePathGenerations";
import {
	type WorkspaceTextBatchWriter,
	workspaceTextBatch,
} from "./workspaceTextBatch";
import {
	normalizedWorkspaceRelativePath,
	requireWorkspaceWritePath,
	validateWorkspaceWrites,
} from "./workspaceWriteValidation";

export { normalizedWorkspaceRelativePath } from "./workspaceWriteValidation";

type WorkspaceMutation = void | Promise<void>;

export type WorkspaceFileSystem = {
	recoverPendingWrites?: (rootUri: string) => boolean;
	createDirectory: (rootUri: string, relativePath: string) => WorkspaceMutation;
	deleteDirectory: (rootUri: string, relativePath: string) => WorkspaceMutation;
	deleteTextFile: (rootUri: string, relativePath: string) => WorkspaceMutation;
	moveDirectory: (
		rootUri: string,
		fromRelativePath: string,
		toRelativePath: string,
	) => WorkspaceMutation;
	moveTextFile: (
		rootUri: string,
		fromRelativePath: string,
		toRelativePath: string,
	) => WorkspaceMutation;
	readVaultConfig?: (rootUri: string) => MobileVaultConfig | null;
	readVaultDirectories: (rootUri: string) => string[];
	readTextFile: (rootUri: string, relativePath: string) => string | null;
	readTextFileAsync?: (
		rootUri: string,
		relativePath: string,
	) => Promise<string | null>;
	readVaultFiles: (rootUri: string) => LocalVaultFile[];
	writeVaultConfig?: (
		rootUri: string,
		config: MobileVaultConfig,
	) => WorkspaceMutation;
	writeTextFile: (
		rootUri: string,
		relativePath: string,
		content: string,
	) => WorkspaceMutation;
	writeTextBatch?: WorkspaceTextBatchWriter;
};

export type WorkspaceFileIndex = {
	directories: string[];
	files: LocalVaultFile[];
};

export function createFileSystemWorkspaceRepository(
	fileSystem: WorkspaceFileSystem,
): ReadOnlyWorkspaceRepository {
	return {
		persistWrites: async (writes, request) => {
			if (writes.length === 0) return;
			const rootUri = workspaceRootUri(request);
			if (!rootUri) throw new Error("workspaceNotSelected");
			validateWorkspaceWrites(writes);

			const operations = workspaceWriteOperations(fileSystem, rootUri, writes);
			trackWorkspacePathWrites(rootUri, workspaceWritePaths(writes));
			await persistWorkspaceOperations(rootUri, operations);
		},
		readNoteContent: async (note, request) => {
			const rootUri = workspaceRootUri(request);
			if (!rootUri) return note.rawContent ?? null;
			return withWorkspaceRead(rootUri, (duringLinkedSync) =>
				readWorkspaceNote(fileSystem, rootUri, note, duringLinkedSync),
			);
		},
		readSnapshot: (request) => {
			const rootUri = workspaceRootUri(request);
			if (!rootUri) return emptyFileSystemSnapshot(request);

			const options = workspaceSnapshotOptions(fileSystem, rootUri, request);
			return (
				takePreparedWorkspaceSnapshot(
					request?.workspaceIndex ?? undefined,
					options,
				) ?? buildLocalVaultWorkspaceSnapshot(options)
			);
		},
	};
}

function workspaceWritePaths(writes: MobileWorkspaceWrite[]): string[] {
	return writes.flatMap((write) => {
		if (write.kind === "saveVaultConfig") return ["@vault-config"];
		if (write.kind === "moveNote" || write.kind === "renameFolder")
			return [write.path, write.toPath];
		return [write.path];
	});
}

function workspaceSnapshotOptions(
	fileSystem: WorkspaceFileSystem,
	root: string,
	request?: ReadOnlyWorkspaceRequest,
) {
	const index = recoveredWorkspaceIndex(fileSystem, root, request);
	return {
		...workspaceSnapshotIdentity(root, request),
		files: index?.files ?? fileSystem.readVaultFiles(root),
		folderPaths: index?.directories ?? fileSystem.readVaultDirectories(root),
		vaultConfig: fileSystem.readVaultConfig?.(root) ?? null,
	};
}

function workspaceSnapshotIdentity(
	root: string,
	request?: ReadOnlyWorkspaceRequest,
) {
	return {
		vaultAlias: request?.vaultAlias,
		vaultLabel: workspaceLabel(root, request),
		vaultPath: root,
	};
}

async function readWorkspaceNote(
	fileSystem: WorkspaceFileSystem,
	root: string,
	note: MobileNote,
	duringLinkedSync = false,
) {
	if (!duringLinkedSync) fileSystem.recoverPendingWrites?.(root);
	const relativePath = noteRelativePath(note);
	if (!relativePath) return null;
	return fileSystem.readTextFileAsync
		? fileSystem.readTextFileAsync(root, relativePath)
		: fileSystem.readTextFile(root, relativePath);
}

function workspaceWriteOperations(
	fileSystem: WorkspaceFileSystem,
	root: string,
	writes: MobileWorkspaceWrite[],
) {
	const batchWriter = fileSystem.writeTextBatch;
	const batch = batchWriter && workspaceTextBatch(writes);
	if (batch) return [() => batchWriter(root, batch)];
	return writes.map(
		(write) => () => persistWorkspaceWrite(fileSystem, root, write),
	);
}

function recoveredWorkspaceIndex(
	fileSystem: WorkspaceFileSystem,
	root: string,
	request?: ReadOnlyWorkspaceRequest,
) {
	if (fileSystem.recoverPendingWrites?.(root)) return undefined;
	return request?.workspaceIndex;
}

function persistWorkspaceWrite(
	fileSystem: WorkspaceFileSystem,
	rootUri: string,
	write: MobileWorkspaceWrite,
) {
	if (write.kind === "saveVaultConfig") {
		return persistVaultConfig(fileSystem, rootUri, write.config);
	}

	const relativePath = requireWorkspaceWritePath(write.path);

	if (isDeleteTextWrite(write)) {
		return fileSystem.deleteTextFile(rootUri, relativePath);
	}

	if (write.kind === "createFolder") {
		return fileSystem.createDirectory(rootUri, relativePath);
	}

	if (write.kind === "deleteFolder") {
		return fileSystem.deleteDirectory(rootUri, relativePath);
	}

	return persistMoveOrTextWrite(fileSystem, rootUri, relativePath, write);
}

function persistVaultConfig(
	fileSystem: WorkspaceFileSystem,
	rootUri: string,
	config?: MobileVaultConfig,
) {
	if (!config || !fileSystem.writeVaultConfig)
		throw new Error("unsupportedWorkspaceConfig");
	return fileSystem.writeVaultConfig(rootUri, config);
}

function persistMoveOrTextWrite(
	fileSystem: WorkspaceFileSystem,
	rootUri: string,
	relativePath: string,
	write: Extract<
		MobileWorkspaceWrite,
		{
			kind:
				| "createNote"
				| "moveNote"
				| "renameFolder"
				| "saveNote"
				| "saveView";
		}
	>,
) {
	if (write.kind === "moveNote") {
		return fileSystem.moveTextFile(
			rootUri,
			relativePath,
			requireWorkspaceWritePath(write.toPath),
		);
	}

	if (write.kind === "renameFolder") {
		return fileSystem.moveDirectory(
			rootUri,
			relativePath,
			requireWorkspaceWritePath(write.toPath),
		);
	}

	return fileSystem.writeTextFile(rootUri, relativePath, write.content);
}

function isDeleteTextWrite(
	write: MobileWorkspaceWrite,
): write is Extract<
	MobileWorkspaceWrite,
	{ kind: "deleteNote" | "deleteView" }
> {
	return write.kind === "deleteNote" || write.kind === "deleteView";
}

function workspaceRootUri(request?: ReadOnlyWorkspaceRequest): string | null {
	return request?.vaultRootUri ?? null;
}

function workspaceLabel(rootUri: string, request?: ReadOnlyWorkspaceRequest) {
	const directoryName = rootUri.split("/").filter(Boolean).at(-1);
	return (
		request?.vaultLabel?.trim() ||
		decodedDirectoryName(directoryName) ||
		"Memoria Vault"
	);
}

function decodedDirectoryName(directoryName: string | undefined) {
	if (!directoryName) return "";

	try {
		return decodeURIComponent(directoryName);
	} catch {
		return directoryName;
	}
}

function emptyFileSystemSnapshot(
	request?: ReadOnlyWorkspaceRequest,
): MobileWorkspaceSnapshot {
	const snapshot = buildLocalVaultWorkspaceSnapshot({
		files: [],
		vaultAlias: request?.vaultAlias,
		vaultLabel: request?.vaultLabel ?? "Memoria Vault",
		vaultPath: request?.vaultRootUri ?? "",
	});

	return {
		...snapshot,
		sync: { kind: "noVault" },
	};
}

function noteRelativePath(note: MobileNote): string | null {
	return normalizedWorkspaceRelativePath(note.path ?? note.id);
}
