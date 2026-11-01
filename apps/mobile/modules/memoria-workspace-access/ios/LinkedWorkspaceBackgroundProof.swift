#if DEBUG || MEMORIA_QA
import Foundation

// A separate home keeps the fixture out of the user's vault catalog and bookmarks.
func runLinkedWorkspaceBackgroundProof() throws -> Bool {
  let home = FileManager.default.temporaryDirectory.appendingPathComponent("memoria-background-qa-\(UUID().uuidString)")
  let source = home.appendingPathComponent("provider")
  let cache = home.appendingPathComponent("Documents/Local Vaults/local-qa")
  try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: home) }
  try Data("original".utf8).write(to: source.appendingPathComponent("note.md"))
  let store = LinkedWorkspaceStore(home: home)
  _ = try store.connect(source: source, cache: cache)
  let draft = Data("---\ncustom: preserved\n---\n# Background folder draft\n".utf8)
  try draft.write(to: cache.appendingPathComponent("note.md"), options: .atomic)
  let result = try store.sync(cache.absoluteString)
  return try result["conflict"] == false && Data(contentsOf: source.appendingPathComponent("note.md")) == draft
}
#endif
