import CryptoKit
import Foundation

struct WorkspaceEntryFingerprint: Codable, Equatable {
  let directory: Bool
  let digest: String
}

func workspaceEntryFingerprint(_ url: URL) throws -> WorkspaceEntryFingerprint? {
  let attributes: [FileAttributeKey: Any]
  do { attributes = try FileManager.default.attributesOfItem(atPath: url.path) }
  catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
    return nil
  }
  let kind = attributes[.type] as? FileAttributeType
  if kind == .typeSymbolicLink { throw WorkspaceFileError.symbolicLink }
  if kind == .typeRegular { return .init(directory: false, digest: try entryFileDigest(url)) }
  guard kind == .typeDirectory else { throw WorkspaceFileError.invalidPath }
  return .init(directory: true, digest: try entryDirectoryDigest(url))
}

private func entryFileDigest(_ url: URL) throws -> String {
  let file = try FileHandle(forReadingFrom: url)
  defer { try? file.close() }
  var hash = SHA256()
  while let chunk = try file.read(upToCount: 65_536), !chunk.isEmpty {
    hash.update(data: chunk)
  }
  return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

private func entryDirectoryDigest(_ url: URL) throws -> String {
  let names = try FileManager.default.contentsOfDirectory(atPath: url.path).sorted()
  var hash = SHA256()
  for name in names {
    let child = try workspaceFileURL(root: url, path: name)
    guard let fingerprint = try workspaceEntryFingerprint(child) else { throw WorkspaceFileError.externalChange }
    let description = "\(name.utf8.count):\(name):\(fingerprint.directory):\(fingerprint.digest)"
    hash.update(data: Data(description.utf8))
  }
  return hash.finalize().map { String(format: "%02x", $0) }.joined()
}
