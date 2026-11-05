import Foundation

struct LinkedWorkspaceState: Codable {
  var version = 1
  var bookmark: Data
  var baseline: [String: String]
}

struct LinkedWorkspaceSession {
  let cache: URL
  let stateFile: URL

  var isLinked: Bool { FileManager.default.fileExists(atPath: stateFile.path) }

  func connect(source: URL) throws {
    guard !isLinked, !FileManager.default.fileExists(atPath: cache.path) else { throw LinkedWorkspaceError.invalidState }
    guard !cache.path.hasPrefix(source.path + "/"), !source.path.hasPrefix(cache.path + "/") else { throw LinkedWorkspaceError.invalidState }
    try withLinkedWorkspaceAccess(source) { coordinated in
      let tree = LinkedWorkspaceTree(root: coordinated)
      let entries = try tree.snapshot()
      let bookmark = try source.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
      try LinkedWorkspaceTree(root: cache).apply(entries, previous: [:], source: tree)
      try save(LinkedWorkspaceState(bookmark: bookmark, baseline: entries))
    }
  }

  /// Returns true only when incoming changes modified the app's working copy.
  func sync() throws -> Bool {
    try withState { state, external in
      let local = LinkedWorkspaceTree(root: cache)
      let before = try local.snapshot()
      let publication = LinkedConflictPublication(stateFile: stateFile)
      if publication.pending {
        state.baseline = try publication.apply(local: local, remote: external)
        try save(state)
        try publication.finish()
        return before != state.baseline
      }
      let remote = try external.snapshot()
      let plan = try LinkedWorkspacePlan(base: state.baseline, local: before, external: remote)
      // Keep the old baseline until BOTH sides finish so a crash is retryable.
      try external.apply(plan.merged, previous: remote, source: local)
      try local.apply(plan.merged, previous: before, source: external)
      state.baseline = plan.merged
      return before != plan.merged
    }
  }

  func withState<T>(_ action: (inout LinkedWorkspaceState, LinkedWorkspaceTree) throws -> T) throws -> T {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    var state = try JSONDecoder().decode(LinkedWorkspaceState.self, from: Data(contentsOf: stateFile))
    guard state.version == 1 else { throw LinkedWorkspaceError.invalidState }
    var stale = false
    let source = try URL(resolvingBookmarkData: state.bookmark, options: .withoutUI, bookmarkDataIsStale: &stale)
    return try withLinkedWorkspaceAccess(source) { coordinated in
      if stale { state.bookmark = try source.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) }
      let external = LinkedWorkspaceTree(root: coordinated)
      let result = try action(&state, external)
      try save(state)
      return result
    }
  }

  func save(_ state: LinkedWorkspaceState) throws {
    try FileManager.default.createDirectory(at: stateFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(state).write(to: stateFile, options: .atomic)
  }
}

private func withLinkedWorkspaceAccess<T>(_ root: URL, action: (URL) throws -> T) throws -> T {
  let scoped = root.startAccessingSecurityScopedResource()
  defer { if scoped { root.stopAccessingSecurityScopedResource() } }
  try requireWorkspaceMutationRoot(root)
  var error: NSError?
  var result: Result<T, Error>?
  NSFileCoordinator().coordinate(writingItemAt: root, options: [], error: &error) { coordinated in
    result = Result { try action(coordinated) }
  }
  if let error { throw error }
  guard let result else { throw WorkspaceFileError.coordinationFailed }
  return try result.get()
}
