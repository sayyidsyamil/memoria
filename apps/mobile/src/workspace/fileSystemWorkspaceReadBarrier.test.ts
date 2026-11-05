import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import {
	createFileSystemWorkspaceRepository,
	type WorkspaceFileSystem,
} from "./fileSystemWorkspaceRepository";
import { withWorkspaceOperation } from "./git/workspaceOperationQueue";
import { syncLinkedWorkspace } from "./linkedWorkspace";
import type { MobileNote } from "./mobileWorkspaceModel";
import type { NativeWorkspaceAccessModule } from "./nativeWorkspaceAccess";

const note: MobileNote = {
	id: "note.md",
	path: "note.md",
	title: "Note",
	created: "",
	date: "",
	modified: "",
	favorite: false,
	links: 0,
	relationships: [],
	status: "",
	snippet: "",
	tags: [],
	type: "Note",
	typeTone: "gray",
	workspace: "",
};

function deferred() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function fixture(name: string) {
	const readTextFile = vi.fn<WorkspaceFileSystem["readTextFile"]>(
		() => "# After",
	);
	const writeTextFile = vi.fn<WorkspaceFileSystem["writeTextFile"]>(
		async () => {},
	);
	const recoverPendingWrites = vi.fn<
		NonNullable<WorkspaceFileSystem["recoverPendingWrites"]>
	>(() => false);
	const fileSystem: WorkspaceFileSystem = {
		createDirectory: vi.fn(),
		deleteDirectory: vi.fn(),
		deleteTextFile: vi.fn(),
		moveDirectory: vi.fn(),
		moveTextFile: vi.fn(),
		readVaultDirectories: () => [],
		readTextFile,
		readVaultFiles: () => [],
		writeTextFile,
		recoverPendingWrites,
	};
	fileSystem.readTextFileAsync = vi.fn(async (root, path) =>
		fileSystem.readTextFile(root, path),
	);
	return {
		fileSystem,
		mocks: { readTextFile, writeTextFile, recoverPendingWrites },
		repository: createFileSystemWorkspaceRepository(fileSystem),
		request: {
			source: "native" as const,
			vaultRootUri: `file:///read-barrier-${name}`,
		},
	};
}

it("waits asynchronously for an active save before entering synchronous native recovery", async () => {
	const { mocks, repository, request } = fixture("save");
	const started = deferred();
	const finish = deferred();
	mocks.writeTextFile.mockImplementation(async () => {
		started.release();
		await finish.promise;
	});
	const save = repository.persistWrites(
		[{ kind: "saveNote", path: "note.md", content: "# After" }],
		request,
	);
	await started.promise;
	const read = repository.readNoteContent(note, request);
	try {
		await Promise.resolve();
		expect(mocks.recoverPendingWrites).not.toHaveBeenCalled();
		expect(mocks.readTextFile).not.toHaveBeenCalled();
	} finally {
		finish.release();
		await save;
		await read;
	}
	expect(await read).toBe("# After");
	expect(mocks.recoverPendingWrites).toHaveBeenCalledExactlyOnceWith(
		request.vaultRootUri,
	);
});

it("waits for Git on the same root while other vault reads can continue", async () => {
	const { mocks, repository, request } = fixture("git");
	const started = deferred();
	const finish = deferred();
	const sync = withWorkspaceOperation(request.vaultRootUri, async () => {
		started.release();
		await finish.promise;
	});
	await started.promise;
	const read = repository.readNoteContent(note, request);
	try {
		const other = fixture("other");
		expect(await other.repository.readNoteContent(note, other.request)).toBe(
			"# After",
		);
		expect(mocks.recoverPendingWrites).not.toHaveBeenCalled();
	} finally {
		finish.release();
		await sync;
		await read;
	}
	expect(await read).toBe("# After");
});

it("reads from the managed workspace during linked sync but keeps writes serialized", async () => {
	const { mocks, repository, request } = fixture("linked-sync");
	const started = deferred();
	const finish = deferred();
	const native: NativeWorkspaceAccessModule = {
		importWorkspace: async () => null,
		restoreWorkspace: async () => null,
		syncLinkedWorkspace: async () => {
			started.release();
			await finish.promise;
			return { linked: true, changed: true, conflict: false };
		},
	};
	const sync = syncLinkedWorkspace(request.vaultRootUri, native);
	await started.promise;
	const recoveryCalls = mocks.recoverPendingWrites.mock.calls.length;
	const read = repository.readNoteContent(note, request);
	let readFinished = false;
	try {
		readFinished = await Promise.race([
			read.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
		]);
		expect(readFinished).toBe(true);
		await expect(read).resolves.toBe("# After");
		expect(mocks.recoverPendingWrites).toHaveBeenCalledTimes(recoveryCalls);

		const write = repository.persistWrites(
			[{ kind: "saveNote", path: "note.md", content: "# New write" }],
			request,
		);
		await Promise.resolve();
		expect(mocks.writeTextFile).not.toHaveBeenCalled();
		finish.release();
		await Promise.all([sync, write]);
		expect(mocks.writeTextFile).toHaveBeenCalledOnce();
	} finally {
		finish.release();
		await sync;
	}
});

it("still rejects cached content if recovery reports an external conflict", async () => {
	const { mocks, repository, request } = fixture("conflict");
	mocks.recoverPendingWrites.mockImplementation(() => {
		throw new Error("externalChange");
	});
	await expect(
		repository.readNoteContent({ ...note, rawContent: "# Stale" }, request),
	).rejects.toThrow("externalChange");
	expect(mocks.readTextFile).not.toHaveBeenCalled();
});

it("reads exact disk bytes instead of trusting cached content for a native note", async () => {
	const { mocks, repository, request } = fixture("cached-note");
	mocks.readTextFile.mockReturnValue("# Current disk bytes");

	await expect(
		repository.readNoteContent(
			{ ...note, rawContent: "# Stale cached bytes" },
			request,
		),
	).resolves.toBe("# Current disk bytes");
	expect(mocks.readTextFile).toHaveBeenCalledExactlyOnceWith(
		request.vaultRootUri,
		"note.md",
	);
});

it("uses a disposable vault file as the source of truth for cached note content", async () => {
	const root = await mkdtemp(join(tmpdir(), "memoria-disk-read-"));
	const notePath = join(root, "note.md");
	const rootUri = pathToFileURL(`${root}/`).href;
	try {
		await writeFile(notePath, "# Disk version", "utf8");
		const fileSystem = {
			createDirectory: vi.fn(),
			deleteDirectory: vi.fn(),
			deleteTextFile: vi.fn(),
			moveDirectory: vi.fn(),
			moveTextFile: vi.fn(),
			readVaultDirectories: () => [],
			readTextFile: vi.fn(),
			readTextFileAsync: async (_root: string, path: string) =>
				readFile(join(root, path), "utf8"),
			readVaultFiles: () => [],
			writeTextFile: vi.fn(),
			recoverPendingWrites: vi.fn(() => false),
		} satisfies WorkspaceFileSystem;
		const repository = createFileSystemWorkspaceRepository(fileSystem);

		await expect(
			repository.readNoteContent(
				{ ...note, rawContent: "# Cached version" },
				{ source: "native", vaultRootUri: rootUri },
			),
		).resolves.toBe("# Disk version");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("does not strand a read behind a failed operation", async () => {
	const { repository, request } = fixture("failure");
	const failed = withWorkspaceOperation(request.vaultRootUri, async () => {
		throw new Error("failed");
	});
	const read = repository.readNoteContent(note, request);
	await expect(failed).rejects.toThrow("failed");
	await expect(read).resolves.toBe("# After");
});
