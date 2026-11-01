import Foundation

struct WorkspaceEntryChange: Codable, Equatable {
  let path: String
  let toPath: String?
  let directory: Bool
  var identifier: String = UUID().uuidString
}

enum WorkspaceEntryStage { case prepared, published, relocated, committed }

private struct PendingWorkspaceEntry: Codable {
  let version: Int
  let change: WorkspaceEntryChange
  let before: WorkspaceEntryFingerprint
}

struct WorkspaceEntryRecovery {
  let root: URL
  let journal: URL
  var afterStage: (WorkspaceEntryStage) throws -> Void = { _ in }

  private var removedEntry: URL { journal.appendingPathExtension("removed") }
  var receipt: URL { journal.appendingPathExtension("completed") }

  func perform(_ change: WorkspaceEntryChange) throws {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    _ = try recover()
    try requireWorkspaceMutationRoot(root)
    if try completed(change) { return }
    let source = try workspaceFileURL(root: root, path: change.path)
    let destination = try destinationFor(change)
    guard let before = try workspaceEntryFingerprint(source) else {
      if change.toPath != nil { throw CocoaError(.fileReadNoSuchFile) }
      return
    }
    guard before.directory == change.directory else { throw WorkspaceFileError.invalidPath }
    if source == destination { return }
    guard try workspaceEntryFingerprint(destination) == nil else { throw CocoaError(.fileWriteFileExists) }
    let pending = PendingWorkspaceEntry(version: 1, change: change, before: before)
    try afterStage(.prepared)
    try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(pending).write(to: journal, options: .atomic)
    try afterStage(.published)
    try complete(pending)
  }

  @discardableResult
  func recover() throws -> Bool {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    guard FileManager.default.fileExists(atPath: journal.path) else {
      try cleanRemovedEntry()
      return false
    }
    let pending = try JSONDecoder().decode(PendingWorkspaceEntry.self, from: Data(contentsOf: journal))
    guard pending.version == 1 else { throw WorkspaceTextRecoveryError.invalidRecord }
    try requireWorkspaceMutationRoot(root)
    try complete(pending)
    return true
  }

  private func complete(_ pending: PendingWorkspaceEntry) throws {
    let source = try workspaceFileURL(root: root, path: pending.change.path)
    let destination = try destinationFor(pending.change)
    try coordinateWorkspaceRelocation(source, destination) {
      _ = try workspaceFileURL(root: root, path: pending.change.path)
      _ = try destinationFor(pending.change)
      try relocatePending(pending, source: source, destination: destination)
    }
    try afterStage(.relocated)
    try JSONEncoder().encode(pending).write(to: receipt, options: .atomic)
    try FileManager.default.removeItem(at: journal)
    try afterStage(.committed)
    try cleanRemovedEntry()
  }

  private func relocatePending(_ pending: PendingWorkspaceEntry, source: URL, destination: URL) throws {
    let current = try workspaceEntryFingerprint(source)
    let target = try workspaceEntryFingerprint(destination)
    if current == nil && target == pending.before { return }
    guard current == pending.before, target == nil else { throw WorkspaceFileError.externalChange }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    _ = try destinationFor(pending.change)
    try relocateWorkspaceEntry(source, destination)
  }

  private func destinationFor(_ change: WorkspaceEntryChange) throws -> URL {
    guard let path = change.toPath else { return removedEntry }
    guard !path.hasPrefix(change.path + "/") else { throw WorkspaceFileError.invalidPath }
    return try workspaceFileURL(root: root, path: path)
  }

  private func completed(_ change: WorkspaceEntryChange) throws -> Bool {
    guard FileManager.default.fileExists(atPath: receipt.path) else { return false }
    let completed = try JSONDecoder().decode(PendingWorkspaceEntry.self, from: Data(contentsOf: receipt))
    guard completed.version == 1 else { throw WorkspaceTextRecoveryError.invalidRecord }
    guard completed.change.identifier == change.identifier else { return false }
    guard completed.change == change else { throw WorkspaceTextRecoveryError.invalidRecord }
    return true
  }

  private func cleanRemovedEntry() throws {
    if FileManager.default.fileExists(atPath: removedEntry.path) {
      try FileManager.default.removeItem(at: removedEntry)
    }
  }
}
