import CryptoKit
import Foundation

struct LinkedWorkspaceStore {
  let home: URL

  init(home: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) { self.home = home }

  func session(_ uri: String) throws -> LinkedWorkspaceSession {
    let path = try managedWorkspaceRelativePath(uri, home: home)
    let cache = try workspaceFileURL(root: home, path: path)
    let key = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
    let state = home.appendingPathComponent("Library/Application Support/MemoriaLinkedFolders/\(key).json")
    return LinkedWorkspaceSession(cache: cache, stateFile: state)
  }

  func connect(source: URL, cache: URL) throws -> String {
    let link = try session(cache.absoluteString)
    try link.connect(source: source)
    return try WorkspaceFileIndex(root: cache).json()
  }

  func sync(_ uri: String) throws -> [String: Bool] {
    let link = try session(uri)
    guard link.isLinked else { return ["linked": false, "changed": false, "conflict": false] }
    try managedWorkspaceText(uri, home: home).recover()
    do {
      return ["linked": true, "changed": try link.sync(), "conflict": false]
    } catch LinkedWorkspaceError.conflict {
      // A late compare-and-swap conflict may follow successful incoming writes.
      return ["linked": true, "changed": true, "conflict": true]
    }
  }
}
