#if DEBUG || MEMORIA_QA
import Foundation

private enum EntryProofFailure: Error { case interrupted, didNotInterrupt, invalidPhase }
private let entryProofBytes = Data([0, 255, 1, 2, 3])

func runWorkspaceEntryNativeProof(_ phase: String) throws -> [String: Any] {
  let cache = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
  let writer = try managedWorkspaceText(cache.appendingPathComponent("MemoriaEntryRecoveryQA").absoluteString)
  switch phase {
  case "entry-prepare-move", "entry-prepare-delete", "entry-prepare-conflict":
    try prepareEntryProof(writer, phase: phase)
  case "inspect": break
  case "cleanup":
    try clearEntryProof(writer)
    return ["cleaned": true]
  default: throw EntryProofFailure.invalidPhase
  }
  return try inspectEntryProof(writer)
}

private func prepareEntryProof(_ writer: WorkspaceTextRecovery, phase: String) throws {
  try clearEntryProof(writer)
  let source = writer.root.appendingPathComponent("source/nested")
  try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
  try Data("---\ncustom: retained\n---\n# Entry recovery\n".utf8).write(to: source.appendingPathComponent("note.md"))
  try entryProofBytes.write(to: source.appendingPathComponent("image.bin"))
  let deleting = phase == "entry-prepare-delete"
  var entries = writer.entryRecovery
  entries.afterStage = { stage in
    if stage == (deleting ? .relocated : .published) { throw EntryProofFailure.interrupted }
  }
  do {
    try entries.perform(.init(path: "source", toPath: deleting ? nil : "target", directory: true))
    throw EntryProofFailure.didNotInterrupt
  } catch EntryProofFailure.interrupted { /* The host terminates the app before replay. */ }
  if phase == "entry-prepare-conflict" {
    try Data("external edit".utf8).write(to: source.appendingPathComponent("note.md"), options: .atomic)
  }
}

private func inspectEntryProof(_ writer: WorkspaceTextRecovery) throws -> [String: Any] {
  let destination = writer.root.appendingPathComponent("target/nested")
  let exists = FileManager.default.fileExists(atPath: destination.path)
  return [
    "rootUri": writer.root.absoluteString,
    "pending": FileManager.default.fileExists(atPath: writer.entryRecovery.journal.path),
    "sourceExists": FileManager.default.fileExists(atPath: writer.root.appendingPathComponent("source").path),
    "destinationExists": exists,
    "binaryPreserved": try exists && Data(contentsOf: destination.appendingPathComponent("image.bin")) == entryProofBytes,
    "frontmatterPreserved": try exists && String(contentsOf: destination.appendingPathComponent("note.md"))
      == "---\ncustom: retained\n---\n# Entry recovery\n",
  ]
}

private func clearEntryProof(_ writer: WorkspaceTextRecovery) throws {
  for url in [writer.root, writer.journal, writer.entryRecovery.journal, writer.entryRecovery.receipt, writer.entryRecovery.journal.appendingPathExtension("removed")]
    where FileManager.default.fileExists(atPath: url.path) {
    try FileManager.default.removeItem(at: url)
  }
}
#endif
