import Foundation

struct WorkspaceTextChange {
  let path: String
  let content: String

  var fingerprint: WorkspaceTextFingerprint {
    .init(path: path, digest: textRecoveryDigest(Data(content.utf8)))
  }
}

struct WorkspaceTextFingerprint: Codable, Equatable {
  let path: String
  let digest: String
}

struct PendingWorkspaceText: Codable {
  let path: String
  let before: String?
  let content: Data

  var fingerprint: WorkspaceTextFingerprint {
    .init(path: path, digest: textRecoveryDigest(content))
  }
}

struct WorkspaceTextRecord: Codable {
  let version: Int
  let identifier: String?
  let entries: [PendingWorkspaceText]

  init(identifier: String?, entries: [PendingWorkspaceText]) {
    version = 2
    self.identifier = identifier
    self.entries = entries
  }

  static func read(_ data: Data) throws -> WorkspaceTextRecord {
    let decoder = JSONDecoder()
    if try textRecordVersion(data) == 1 {
      let old = try decoder.decode(LegacyPendingText.self, from: data)
      return .init(identifier: old.identifier, entries: [.init(path: old.path, before: old.before, content: old.content)])
    }
    let record = try decoder.decode(WorkspaceTextRecord.self, from: data)
    guard record.version == 2, record.identifier != nil else { throw WorkspaceTextRecoveryError.invalidRecord }
    return record
  }
}

struct CompletedWorkspaceText: Codable {
  let version: Int
  let identifier: String
  let entries: [WorkspaceTextFingerprint]

  init(identifier: String, entries: [WorkspaceTextFingerprint]) {
    version = 2
    self.identifier = identifier
    self.entries = entries
  }

  static func read(_ data: Data) throws -> CompletedWorkspaceText {
    let decoder = JSONDecoder()
    if try textRecordVersion(data) == 1 {
      let old = try decoder.decode(LegacyCompletedText.self, from: data)
      return .init(identifier: old.identifier, entries: [.init(path: old.path, digest: old.digest)])
    }
    let record = try decoder.decode(CompletedWorkspaceText.self, from: data)
    guard record.version == 2 else { throw WorkspaceTextRecoveryError.invalidRecord }
    return record
  }
}

private struct LegacyPendingText: Decodable {
  let path: String
  let before: String?
  let content: Data
  let identifier: String?
}

private struct LegacyCompletedText: Decodable {
  let identifier: String
  let path: String
  let digest: String
}

private func textRecordVersion(_ data: Data) throws -> Int {
  struct Version: Decodable { let version: Int }
  return try JSONDecoder().decode(Version.self, from: data).version
}

func validateTextBatchPaths(_ paths: [String]) throws {
  let unique = Set(paths)
  guard !paths.isEmpty, unique.count == paths.count else { throw WorkspaceTextRecoveryError.invalidRecord }
  for path in paths {
    var parent = ""
    for part in path.split(separator: "/").dropLast() {
      parent += parent.isEmpty ? String(part) : "/" + part
      if unique.contains(parent) { throw WorkspaceTextRecoveryError.invalidRecord }
    }
  }
}
