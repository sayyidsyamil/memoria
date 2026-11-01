import Foundation

func managedWorkspaceRelativePath(_ uri: String, home: URL) throws -> String {
  try ManagedWorkspacePath(home: home).relativePath(uri)
}

struct ManagedWorkspacePath {
  private let prefix: String

  init(home: URL) { prefix = home.path + "/" }

  func relativePath(_ uri: String) throws -> String {
    // Normalization can access the filesystem and hide symlink/dot traversal.
    let path = try localFileURL(uri).path
    guard path.hasPrefix(prefix), !path.contains("\0"), !path.contains("\\") else {
      throw WorkspaceFileError.invalidPath
    }
    let relative = String(path.dropFirst(prefix.count))
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
      relative.hasPrefix("Documents/") || relative.hasPrefix("Library/Caches/") || relative.hasPrefix("tmp/") else {
      throw WorkspaceFileError.invalidPath
    }
    return relative
  }
}

private func localFileURL(_ uri: String) throws -> URL {
  guard let url = URL(string: uri), url.isFileURL,
    url.host == nil || url.host == "" || url.host == "localhost",
    url.user == nil, url.password == nil, url.port == nil,
    url.query == nil, url.fragment == nil else { throw WorkspaceFileError.invalidPath }
  return url
}
