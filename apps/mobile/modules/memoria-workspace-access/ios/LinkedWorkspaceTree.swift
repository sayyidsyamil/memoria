import CryptoKit
import Foundation

struct LinkedWorkspaceTree {
  let root: URL

  func snapshot() throws -> [String: String] {
    try requireWorkspaceMutationRoot(root)
    _ = try downloadedWorkspaceItemValues(root)
    var failure: Error?
    let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]
    guard let entries = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, errorHandler: { _, error in
      failure = error
      return false
    }) else { throw WorkspaceFileError.coordinationFailed }
    var result: [String: String] = [:]
    for case let url as URL in entries {
      if [".git", "node_modules", ".ds_store"].contains(url.lastPathComponent.lowercased()) {
        entries.skipDescendants()
        continue
      }
      let prefix = root.standardizedFileURL.path + "/"
      let absolute = url.standardizedFileURL.path
      guard absolute.hasPrefix(prefix) else { throw WorkspaceFileError.invalidPath }
      let path = String(absolute.dropFirst(prefix.count))
      result[path] = try fingerprint(path)
    }
    if let failure { throw failure }
    return result
  }

  func fingerprint(_ path: String) throws -> String? {
    let file = try workspaceFileURL(root: root, path: path)
    guard let values = try downloadedWorkspaceItemValues(file) else { return nil }
    guard values.isSymbolicLink != true else { throw WorkspaceFileError.symbolicLink }
    if values.isDirectory == true { return "directory" }
    guard values.isRegularFile == true else { throw WorkspaceFileError.invalidPath }
    return try linkedWorkspaceDigest(Data(contentsOf: file, options: .mappedIfSafe))
  }

  func apply(_ desired: [String: String], previous: [String: String], source: LinkedWorkspaceTree) throws {
    let removals = previous.keys.filter { needsRemoval(previous[$0], desired[$0]) }.sorted { $0.count > $1.count }
    for path in removals { try remove(path, expected: previous[path]) }
    for path in desired.keys.sorted() where previous[path] != desired[path] {
      guard let value = desired[path] else { continue }
      let expected = removals.contains(path) ? nil : previous[path]
      try copy(path, value: value, expected: expected, source: source)
    }
  }

  private func remove(_ path: String, expected: String?) throws {
    guard try fingerprint(path) == expected else { throw LinkedWorkspaceError.conflict }
    let file = try workspaceFileURL(root: root, path: path)
    if expected == "directory" {
      guard try FileManager.default.contentsOfDirectory(atPath: file.path).isEmpty else { throw LinkedWorkspaceError.conflict }
    }
    try FileManager.default.removeItem(at: file)
  }

  private func copy(_ path: String, value: String, expected: String?, source: LinkedWorkspaceTree) throws {
    guard try fingerprint(path) == expected else { throw LinkedWorkspaceError.conflict }
    let destination = try workspaceFileURL(root: root, path: path)
    if value == "directory" {
      try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
      return
    }
    let origin = try workspaceFileURL(root: source.root, path: path)
    let data = try Data(contentsOf: origin, options: .mappedIfSafe)
    guard linkedWorkspaceDigest(data) == value else { throw LinkedWorkspaceError.conflict }
    try data.write(to: destination, options: .atomic)
  }
}

private func needsRemoval(_ previous: String?, _ desired: String?) -> Bool {
  desired == nil || (previous == "directory") != (desired == "directory")
}

private func linkedWorkspaceDigest(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func downloadedWorkspaceItemValues(_ file: URL) throws -> URLResourceValues? {
  // An evicted iCloud file must never look like a user deletion in the merge.
  if file.lastPathComponent.hasPrefix("."), file.pathExtension == "icloud" {
    throw WorkspaceFileError.coordinationFailed
  }
  guard let values = try workspaceItemValues(file) else { return nil }
  if linkedWorkspaceRequiresDownload(values.ubiquitousItemDownloadingStatus) {
    try FileManager.default.startDownloadingUbiquitousItem(at: file)
    throw WorkspaceFileError.coordinationFailed
  }
  return values
}

func linkedWorkspaceRequiresDownload(_ status: URLUbiquitousItemDownloadingStatus?) -> Bool {
  status != nil && status != .current
}

private func workspaceItemValues(_ file: URL) throws -> URLResourceValues? {
  do {
    return try file.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .ubiquitousItemDownloadingStatusKey])
  } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
    return nil
  }
}
