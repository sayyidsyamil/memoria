import Foundation

enum LinkedWorkspaceError: Error {
  case conflict
  case invalidState
}

struct LinkedWorkspacePlan {
  let merged: [String: String]

  init(base: [String: String], local: [String: String], external: [String: String]) throws {
    var result: [String: String] = [:]
    for path in Set(base.keys).union(local.keys).union(external.keys) {
      guard !path.isEmpty else { throw LinkedWorkspaceError.invalidState }
      result[path] = try mergedEntry(base: base[path], local: local[path], external: external[path])
    }
    try requireMergedParents(result)
    merged = result
  }
}

// A deleted/replaced parent cannot silently swallow a new child on the other side.
private func requireMergedParents(_ entries: [String: String]) throws {
  for path in entries.keys {
    let parts = path.split(separator: "/")
    for count in 1..<parts.count {
      guard entries[parts.prefix(count).joined(separator: "/")] == "directory" else {
        throw LinkedWorkspaceError.conflict
      }
    }
  }
}

private func mergedEntry(base: String?, local: String?, external: String?) throws -> String? {
  if local == external { return local }
  if local == base { return external }
  if external == base { return local }
  throw LinkedWorkspaceError.conflict
}
