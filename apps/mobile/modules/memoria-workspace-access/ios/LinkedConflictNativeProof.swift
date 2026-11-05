#if DEBUG || MEMORIA_QA
import Foundation

func runLinkedConflictNativeProof() throws -> Bool {
  let home = FileManager.default.temporaryDirectory.appendingPathComponent("memoria-conflict-qa-\(UUID().uuidString)")
  let source = home.appendingPathComponent("provider")
  let cache = home.appendingPathComponent("Documents/Local Vaults/local-qa")
  try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: home) }
  try Data("original".utf8).write(to: source.appendingPathComponent("note.md"))
  let store = LinkedWorkspaceStore(home: home)
  _ = try store.connect(source: source, cache: cache)
  let session = try store.session(cache.absoluteString)
  try Data("local".utf8).write(to: cache.appendingPathComponent("note.md"), options: .atomic)
  try Data("remote".utf8).write(to: source.appendingPathComponent("note.md"), options: .atomic)
  let review = try session.reviewConflicts()
  guard review.files.count == 1 else { return false }
  try session.resolveConflicts(review, choices: ["note.md": "both"])
  let local = try String(contentsOf: source.appendingPathComponent("note.md"), encoding: .utf8)
  let remote = try String(contentsOf: cache.appendingPathComponent("note (conflict 1).md"), encoding: .utf8)
  return try local == "local" && remote == "remote" && !session.sync()
}
#endif
