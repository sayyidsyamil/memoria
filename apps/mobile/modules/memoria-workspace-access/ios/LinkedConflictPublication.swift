import Foundation

private struct LinkedConflictJournal: Codable {
  let identifier: String
  let local: [String: String]
  let remote: [String: String]
  let merged: [String: String]
}

struct LinkedConflictPublication {
  let stateFile: URL
  private var journal: URL { stateFile.appendingPathExtension("resolution.json") }
  private var backups: URL { stateFile.deletingPathExtension().appendingPathExtension("resolutions") }
  var pending: Bool { FileManager.default.fileExists(atPath: journal.path) }

  func prepare(_ plan: LinkedConflictPlan, review: LinkedConflictReview, local: LinkedWorkspaceTree, remote: LinkedWorkspaceTree) throws {
    guard !pending else { throw LinkedWorkspaceError.invalidState }
    let identifier = UUID().uuidString
    let directory = backups.appendingPathComponent(identifier)
    let staged = LinkedWorkspaceTree(root: directory.appendingPathComponent("merged"))
    try FileManager.default.createDirectory(at: staged.root, withIntermediateDirectories: true)
    try backup(local, snapshot: review.local, to: directory.appendingPathComponent("local"))
    try backup(remote, snapshot: review.remote, to: directory.appendingPathComponent("remote"))
    for path in plan.merged.keys.sorted() {
      guard let origin = plan.origins[path] else { throw LinkedWorkspaceError.invalidState }
      let source = origin.remote ? remote : local
      let destination = try workspaceFileURL(root: staged.root, path: path)
      if plan.merged[path] == "directory" { try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false) }
      else { try FileManager.default.copyItem(at: workspaceFileURL(root: source.root, path: origin.path), to: destination) }
    }
    guard try staged.snapshot() == plan.merged else { throw LinkedWorkspaceError.conflict }
    let record = LinkedConflictJournal(identifier: identifier, local: review.local, remote: review.remote, merged: plan.merged)
    try JSONEncoder().encode(record).write(to: journal, options: .atomic)
  }

  func apply(local: LinkedWorkspaceTree, remote: LinkedWorkspaceTree) throws -> [String: String] {
    let record = try JSONDecoder().decode(LinkedConflictJournal.self, from: Data(contentsOf: journal))
    guard UUID(uuidString: record.identifier) != nil else { throw LinkedWorkspaceError.invalidState }
    let source = LinkedWorkspaceTree(root: backups.appendingPathComponent(record.identifier).appendingPathComponent("merged"))
    guard try source.snapshot() == record.merged else { throw LinkedWorkspaceError.invalidState }
    let currentLocal = try local.snapshot()
    let currentRemote = try remote.snapshot()
    try requireUnchanged(currentLocal, before: record.local, after: record.merged)
    try requireUnchanged(currentRemote, before: record.remote, after: record.merged)
    try remote.apply(record.merged, previous: currentRemote, source: source)
    try local.apply(record.merged, previous: currentLocal, source: source)
    return record.merged
  }

  func finish(now: Date = Date()) throws {
    let record = try JSONDecoder().decode(LinkedConflictJournal.self, from: Data(contentsOf: journal))
    guard UUID(uuidString: record.identifier) != nil else { throw LinkedWorkspaceError.invalidState }
    let directory = try workspaceFileURL(root: safeBackupRoot(), path: record.identifier)
    let marker = try workspaceFileURL(root: directory, path: "completed.json")
    let completed = CompletedLinkedConflict(version: 1, identifier: record.identifier, completedAt: now)
    // Cleanup is optional; a failed marker write must not fail an already saved resolution.
    try? JSONEncoder().encode(completed).write(to: marker, options: .atomic)
    try FileManager.default.removeItem(at: journal)
    try? pruneCompletedBackups(now: now)
  }

  @discardableResult
  func pruneCompletedBackups(now: Date = Date()) throws -> Int {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    let active = try pendingIdentifier()
    let root = try safeBackupRoot()
    guard FileManager.default.fileExists(atPath: root.path) else { return 0 }
    let completed = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
      .compactMap { try? completedBackup($0, now: now) }
      .sorted {
        if $0.record.completedAt != $1.record.completedAt { return $0.record.completedAt > $1.record.completedAt }
        return $0.record.identifier > $1.record.identifier
      }
    var removed = 0
    for backup in completed.dropFirst(3) {
      guard backup.record.identifier != active, now.timeIntervalSince(backup.record.completedAt) > 7 * 86_400 else { continue }
      guard (try? requireNoBackupSymlinks(backup.directory)) != nil else { continue }
      try FileManager.default.removeItem(at: backup.directory)
      removed += 1
    }
    return removed
  }

  private func safeBackupRoot() throws -> URL {
    try workspaceFileURL(root: stateFile.deletingLastPathComponent(), path: backups.lastPathComponent)
  }

  private func pendingIdentifier() throws -> String? {
    guard pending else { return nil }
    let record = try JSONDecoder().decode(LinkedConflictJournal.self, from: Data(contentsOf: journal))
    guard UUID(uuidString: record.identifier) != nil else { throw LinkedWorkspaceError.invalidState }
    return record.identifier
  }

  private func completedBackup(_ directory: URL, now: Date) throws -> CompletedLinkedConflictBackup {
    guard UUID(uuidString: directory.lastPathComponent) != nil else { throw LinkedWorkspaceError.invalidState }
    let checked = try workspaceFileURL(root: safeBackupRoot(), path: directory.lastPathComponent)
    let marker = try workspaceFileURL(root: checked, path: "completed.json")
    let record = try JSONDecoder().decode(CompletedLinkedConflict.self, from: Data(contentsOf: marker))
    guard record.version == 1, record.identifier == directory.lastPathComponent,
      record.completedAt.timeIntervalSince1970.isFinite, record.completedAt <= now,
      Set(try FileManager.default.contentsOfDirectory(atPath: checked.path)) == ["local", "remote", "merged", "completed.json"]
    else { throw LinkedWorkspaceError.invalidState }
    return CompletedLinkedConflictBackup(directory: checked, record: record)
  }

  func supersede() throws {
    guard pending else { return }
    let record = try JSONDecoder().decode(LinkedConflictJournal.self, from: Data(contentsOf: journal))
    guard UUID(uuidString: record.identifier) != nil else { throw LinkedWorkspaceError.invalidState }
    let archived = backups.appendingPathComponent(record.identifier).appendingPathComponent("superseded.json")
    try FileManager.default.moveItem(at: journal, to: archived)
  }

  private func backup(_ tree: LinkedWorkspaceTree, snapshot: [String: String], to: URL) throws {
    try FileManager.default.createDirectory(at: to, withIntermediateDirectories: true)
    try LinkedWorkspaceTree(root: to).apply(snapshot, previous: [:], source: tree)
  }

  private func requireUnchanged(_ current: [String: String], before: [String: String], after: [String: String]) throws {
    for path in Set(current.keys).union(before.keys).union(after.keys) {
      guard current[path] == before[path] || current[path] == after[path] else { throw LinkedWorkspaceError.conflict }
    }
  }
}

private struct CompletedLinkedConflict: Codable {
  let version: Int
  let identifier: String
  let completedAt: Date
}

private struct CompletedLinkedConflictBackup {
  let directory: URL
  let record: CompletedLinkedConflict
}

private func requireNoBackupSymlinks(_ root: URL) throws {
  var enumerationError: Error?
  guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey],
    errorHandler: { _, error in enumerationError = error; return false }) else { throw LinkedWorkspaceError.invalidState }
  for case let url as URL in enumerator where try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
    throw WorkspaceFileError.symbolicLink
  }
  if let enumerationError { throw enumerationError }
}
