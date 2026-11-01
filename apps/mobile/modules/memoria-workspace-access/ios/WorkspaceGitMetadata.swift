import Darwin
import Foundation

final class WorkspaceGitMetadata {
  private let paths: ManagedWorkspacePath
  private let descriptor: Int32

  init(home: URL = URL(fileURLWithPath: NSHomeDirectory())) throws {
    paths = ManagedWorkspacePath(home: home)
    // The trusted home may use Apple's /var alias; vault-relative paths may not.
    descriptor = open(home.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
    guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
  }

  deinit { close(descriptor) }

  func info(_ uri: String) throws -> [String: Any] {
    let relative = try paths.relativePath(uri)
    var metadata = stat()
    guard fstatat(descriptor, relative, &metadata, AT_SYMLINK_NOFOLLOW_ANY) == 0 else {
      let code = errno
      if code == ENOENT || code == ENOTDIR { return ["exists": false] }
      throw NSError(domain: NSPOSIXErrorDomain, code: Int(code))
    }
    let kind = metadata.st_mode & S_IFMT
    if kind == S_IFLNK { throw WorkspaceFileError.symbolicLink }
    guard kind == S_IFREG || kind == S_IFDIR else { throw WorkspaceFileError.invalidPath }
    return [
      "exists": true,
      "isDirectory": kind == S_IFDIR,
      "size": metadata.st_size,
      "modificationTime": milliseconds(metadata.st_mtimespec),
      // Git's ctime is the inode-change time, not the document's creation date.
      "creationTime": milliseconds(metadata.st_ctimespec),
    ]
  }
}

private func milliseconds(_ time: timespec) -> Double {
  return Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000
}
