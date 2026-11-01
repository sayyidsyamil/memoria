import Foundation

struct LinkedConflictVersion: Codable {
  let kind: String
  let text: String
  let truncated: Bool
}

struct LinkedConflictFile: Codable {
  let path: String
  let local: LinkedConflictVersion
  let remote: LinkedConflictVersion
}

struct LinkedConflictReview: Codable {
  let base: [String: String]
  let local: [String: String]
  let remote: [String: String]
  let files: [LinkedConflictFile]
}

extension LinkedWorkspaceSession {
  func reviewConflicts() throws -> LinkedConflictReview {
    try withState { state, external in
      let local = LinkedWorkspaceTree(root: cache)
      let before = try local.snapshot()
      let remote = try external.snapshot()
      let plan = try LinkedConflictPlan(base: state.baseline, local: before, remote: remote)
      let files = try plan.conflicts.map { path in
        LinkedConflictFile(path: path, local: try conflictPreview(local, path: path), remote: try conflictPreview(external, path: path))
      }
      return LinkedConflictReview(base: state.baseline, local: before, remote: remote, files: files)
    }
  }

  func resolveConflicts(_ review: LinkedConflictReview, choices: [String: String]) throws {
    try withState { state, external in
      let local = LinkedWorkspaceTree(root: cache)
      guard state.baseline == review.base, try local.snapshot() == review.local,
        try external.snapshot() == review.remote else { throw LinkedWorkspaceError.conflict }
      let plan = try LinkedConflictPlan(base: review.base, local: review.local, remote: review.remote, choices: choices)
      guard plan.conflicts.allSatisfy({ choices[$0] != nil }) else { throw LinkedWorkspaceError.invalidState }
      let resolution = LinkedConflictPublication(stateFile: stateFile)
      // A fresh explicit review can replace a blocked journal; its originals remain in backups.
      try resolution.supersede()
      try resolution.prepare(plan, review: review, local: local, remote: external)
      state.baseline = try resolution.apply(local: local, remote: external)
      try save(state)
      try resolution.finish()
    }
  }
}

private func conflictPreview(_ tree: LinkedWorkspaceTree, path: String) throws -> LinkedConflictVersion {
  guard let fingerprint = try tree.fingerprint(path) else { return LinkedConflictVersion(kind: "deleted", text: "", truncated: false) }
  if fingerprint == "directory" { return LinkedConflictVersion(kind: "binary", text: "", truncated: false) }
  let data = try Data(contentsOf: workspaceFileURL(root: tree.root, path: path), options: .mappedIfSafe)
  guard !data.contains(0), let text = String(data: data, encoding: .utf8) else { return LinkedConflictVersion(kind: "binary", text: "", truncated: false) }
  return LinkedConflictVersion(kind: "text", text: String(text.prefix(32000)), truncated: text.count > 32000)
}
