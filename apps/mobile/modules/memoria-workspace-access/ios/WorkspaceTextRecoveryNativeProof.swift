#if DEBUG || MEMORIA_QA
import Foundation

private enum TextRecoveryProbeFailure: Error { case interrupted, didNotInterrupt, invalidPhase }
private let textRecoveryProbeIdentifier = "native-text-recovery-qa"

func runWorkspaceTextRecoveryNativeProof(_ phase: String) throws -> [String: Any] {
  let cache = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
  let root = cache.appendingPathComponent("MemoriaTextRecoveryQA")
  let writer = try managedWorkspaceText(root.absoluteString)
  switch phase {
  case "prepare", "prepare-conflict":
    try prepareTextRecoveryProof(writer, conflict: phase == "prepare-conflict")
  case "batch-prepare", "batch-prepare-conflict":
    try prepareTextBatchProof(writer, conflict: phase == "batch-prepare-conflict")
  case "inspect": break
  case "edit-completed":
    try Data("# Later external edit\n".utf8).write(to: root.appendingPathComponent("note.md"), options: .atomic)
  case "cleanup":
    try clearTextRecoveryProof(writer)
    return ["cleaned": true]
  default: throw TextRecoveryProbeFailure.invalidPhase
  }
  return [
    "rootUri": root.absoluteString,
    "content": try String(contentsOf: root.appendingPathComponent("note.md"), encoding: .utf8),
    "secondContent": try optionalProofContent(root.appendingPathComponent("second.md")),
    "completedMembers": try completedProofMembers(writer),
    "pending": FileManager.default.fileExists(atPath: writer.journal.path),
    "privateJournal": !writer.journal.path.hasPrefix(root.path + "/"),
  ]
}

private func optionalProofContent(_ url: URL) throws -> String {
  guard FileManager.default.fileExists(atPath: url.path) else { return "" }
  return try String(contentsOf: url, encoding: .utf8)
}

private func completedProofMembers(_ writer: WorkspaceTextRecovery) throws -> Int {
  guard FileManager.default.fileExists(atPath: writer.receipt.path) else { return 0 }
  return try CompletedWorkspaceText.read(Data(contentsOf: writer.receipt)).entries.count
}

private func prepareTextBatchProof(_ writer: WorkspaceTextRecovery, conflict: Bool) throws {
  try clearTextRecoveryProof(writer)
  try FileManager.default.createDirectory(at: writer.root, withIntermediateDirectories: true)
  let second = writer.root.appendingPathComponent("second.md")
  try Data("# Before\n".utf8).write(to: writer.root.appendingPathComponent("note.md"), options: .atomic)
  try Data("# Second before\n".utf8).write(to: second, options: .atomic)
  var interrupted = writer
  interrupted.afterStage = { stage in
    if stage == .replaced { throw TextRecoveryProbeFailure.interrupted }
  }
  do {
    try interrupted.writeBatch([
      .init(path: "note.md", content: "---\ncustom: retained\n---\n# Recovered\n"),
      .init(path: "second.md", content: "---\ncustom: second\n---\n# Second recovered\n"),
    ], identifier: "native-text-batch-qa")
    throw TextRecoveryProbeFailure.didNotInterrupt
  } catch TextRecoveryProbeFailure.interrupted { /* Simulate termination after the first replacement. */ }
  if conflict { try Data("# External edit\n".utf8).write(to: second, options: .atomic) }
}

private func prepareTextRecoveryProof(_ writer: WorkspaceTextRecovery, conflict: Bool) throws {
  try clearTextRecoveryProof(writer)
  try FileManager.default.createDirectory(at: writer.root, withIntermediateDirectories: true)
  let destination = writer.root.appendingPathComponent("note.md")
  try Data("# Before\n".utf8).write(to: destination, options: .atomic)
  var interrupted = writer
  interrupted.afterStage = { stage in
    if stage == .published { throw TextRecoveryProbeFailure.interrupted }
  }
  do {
    try interrupted.write("note.md", content: "---\ncustom: retained\n---\n# Recovered\n", identifier: textRecoveryProbeIdentifier)
    throw TextRecoveryProbeFailure.didNotInterrupt
  } catch TextRecoveryProbeFailure.interrupted { /* Simulate termination after journal publication. */ }
  if conflict { try Data("# External edit\n".utf8).write(to: destination, options: .atomic) }
}

private func clearTextRecoveryProof(_ writer: WorkspaceTextRecovery) throws {
  for url in [writer.journal, writer.receipt, writer.root] where FileManager.default.fileExists(atPath: url.path) {
    try FileManager.default.removeItem(at: url)
  }
}
#endif
