import Foundation

struct LinkedWorkspaceFixture {
  let source: URL
  let cache: URL
  let state: URL

  init(root: URL) throws {
    source = root.appendingPathComponent("provider")
    cache = root.appendingPathComponent("cache")
    state = root.appendingPathComponent("state.json")
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
  }

  func write(_ path: String, _ text: String, in root: URL) throws {
    let file = root.appendingPathComponent(path)
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(text.utf8).write(to: file, options: .atomic)
  }

  func read(_ path: String, in root: URL) throws -> String {
    try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
  }
}
