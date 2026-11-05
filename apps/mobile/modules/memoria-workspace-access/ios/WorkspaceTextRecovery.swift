import CryptoKit
import Foundation

enum WorkspaceTextWriteStage { case prepared, published, replaced }
enum WorkspaceTextRecoveryError: Error { case invalidRecord, checkoutPending, missingRoot }

struct WorkspaceTextRecovery {
  let root: URL
  let journal: URL
  var afterStage: (WorkspaceTextWriteStage) throws -> Void = { _ in }
  var receipt: URL { journal.appendingPathExtension("completed") }

  func write(_ path: String, content: String, identifier: String = UUID().uuidString) throws {
    try writeBatch([.init(path: path, content: content)], identifier: identifier)
  }

  func writeBatch(_ changes: [WorkspaceTextChange], identifier: String) throws {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    _ = try recover()
    try requireWorkspaceMutationRoot(root)
    try validateTextBatchPaths(changes.map(\.path))
    if try completed(changes, identifier: identifier) { return }
    let entries = try changes.map { change in
      try withDestination(change.path) { destination in
        PendingWorkspaceText(path: change.path, before: try existingDigest(destination), content: Data(change.content.utf8))
      }
    }
    let pending = WorkspaceTextRecord(identifier: identifier, entries: entries)
    try afterStage(.prepared)
    try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(pending).write(to: journal, options: .atomic)
    try afterStage(.published)
    try complete(pending, afterReplace: { try afterStage(.replaced) })
  }

  @discardableResult
  func recover() throws -> Bool {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    let recoveredEntry = try entryRecovery.recover()
    guard let data = try existingData(journal) else { return recoveredEntry }
    let pending = try WorkspaceTextRecord.read(data)
    try requireWorkspaceMutationRoot(root)
    try validateTextBatchPaths(pending.entries.map(\.path))
    try complete(pending)
    return true
  }

  private func completed(_ changes: [WorkspaceTextChange], identifier: String) throws -> Bool {
    guard let data = try existingData(receipt) else { return false }
    let completed = try CompletedWorkspaceText.read(data)
    guard completed.identifier == identifier else { return false }
    guard completed.entries == changes.map(\.fingerprint) else {
      throw WorkspaceTextRecoveryError.invalidRecord
    }
    return true
  }

  private func complete(_ pending: WorkspaceTextRecord, afterReplace: () throws -> Void = {}) throws {
    // Check the whole plan before changing its first member; recheck each write
    // under coordination so an intervening external edit still fails closed.
    for entry in pending.entries {
      try withDestination(entry.path) { try requireExpected(entry, destination: $0) }
    }
    for entry in pending.entries {
      try withDestination(entry.path) { try replace(entry, destination: $0) }
      try afterReplace()
    }
    try recordCompletion(pending)
  }

  private func recordCompletion(_ pending: WorkspaceTextRecord) throws {
    if let identifier = pending.identifier {
      let completed = CompletedWorkspaceText(identifier: identifier, entries: pending.entries.map(\.fingerprint))
      try JSONEncoder().encode(completed).write(to: receipt, options: .atomic)
    }
    try FileManager.default.removeItem(at: journal)
  }

  private func replace(_ pending: PendingWorkspaceText, destination: URL) throws {
    let current = try existingDigest(destination)
    if current == textRecoveryDigest(pending.content) { return }
    guard current == pending.before else { throw WorkspaceFileError.externalChange }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    _ = try workspaceFileURL(root: root, path: pending.path)
    try pending.content.write(to: destination, options: .atomic)
  }

  private func requireExpected(_ pending: PendingWorkspaceText, destination: URL) throws {
    let current = try existingDigest(destination)
    guard current == pending.before || current == textRecoveryDigest(pending.content) else {
      throw WorkspaceFileError.externalChange
    }
  }

  var entryRecovery: WorkspaceEntryRecovery {
    WorkspaceEntryRecovery(root: root, journal: journal.appendingPathExtension("entry"))
  }

  func changeEntry(_ change: WorkspaceEntryChange) throws {
    workspaceMutationLock.lock()
    defer { workspaceMutationLock.unlock() }
    _ = try recover()
    try entryRecovery.perform(change)
  }

  private func withDestination<T>(_ path: String, action: @escaping (URL) throws -> T) throws -> T {
    let destination = try workspaceFileURL(root: root, path: path)
    var coordinationError: NSError?
    var result: Result<T, Error>?
    NSFileCoordinator().coordinate(writingItemAt: destination, options: .forReplacing, error: &coordinationError) { url in
      result = Result {
        _ = try workspaceFileURL(root: root, path: path)
        return try action(url)
      }
    }
    if let coordinationError { throw coordinationError }
    guard let result else { throw WorkspaceFileError.coordinationFailed }
    return try result.get()
  }
}

func textRecoveryDigest(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func existingDigest(_ url: URL) throws -> String? {
  try existingData(url).map(textRecoveryDigest)
}

private func existingData(_ url: URL) throws -> Data? {
  do { return try Data(contentsOf: url) }
  catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
    return nil
  }
}
