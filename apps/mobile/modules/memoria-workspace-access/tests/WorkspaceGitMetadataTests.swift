import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceGitMetadataTests: XCTestCase {
  func testReadsFreshFileAndDirectoryMetadataIncludingGitInternals() throws {
    try withGitMetadataFixture { home, root in
      let reader = try WorkspaceGitMetadata(home: home)
      let file = root.appendingPathComponent("100% note.md")
      try Data("first".utf8).write(to: file)
      let info = try reader.info(file.absoluteString)
      XCTAssertEqual(info["exists"] as? Bool, true)
      XCTAssertEqual(info["isDirectory"] as? Bool, false)
      XCTAssertEqual(info["size"] as? Int64, 5)
      XCTAssertGreaterThan(try XCTUnwrap(info["modificationTime"] as? Double), 0)
      try Data("updated content".utf8).write(to: file)
      XCTAssertEqual(try reader.info(file.absoluteString)["size"] as? Int64, 15)
      let modified = Date(timeIntervalSince1970: 1_800_000_000)
      try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: file.path)
      XCTAssertEqual(try reader.info(file.absoluteString)["modificationTime"] as? Double, 1_800_000_000_000)
      XCTAssertEqual(try reader.info(root.absoluteString)["isDirectory"] as? Bool, true)
      let git = root.appendingPathComponent(".git")
      try FileManager.default.createDirectory(at: git, withIntermediateDirectories: false)
      XCTAssertEqual(try reader.info(git.absoluteString)["isDirectory"] as? Bool, true)
      try FileManager.default.removeItem(at: file)
      XCTAssertEqual(try reader.info(file.absoluteString)["exists"] as? Bool, false)
    }
  }

  func testRejectsBothLeafAndParentSymlinksWithoutFollowingThem() throws {
    try withGitMetadataFixture { home, root in
      let reader = try WorkspaceGitMetadata(home: home)
      let file = root.appendingPathComponent("note.md")
      try Data("private".utf8).write(to: file)
      let link = root.appendingPathComponent("linked.md")
      try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
      XCTAssertThrowsError(try reader.info(link.absoluteString))
      let directoryLink = home.appendingPathComponent("Documents/Linked")
      try FileManager.default.createSymbolicLink(at: directoryLink, withDestinationURL: root)
      XCTAssertThrowsError(try reader.info(directoryLink.appendingPathComponent("note.md").absoluteString))
      XCTAssertThrowsError(try reader.info(directoryLink.appendingPathComponent("missing.md").absoluteString))
    }
  }

  func testRejectsPathsOutsideManagedStorageAndMalformedUris() throws {
    try withGitMetadataFixture { home, root in
      let reader = try WorkspaceGitMetadata(home: home)
      for path in ["Library/Preferences", "Documents/../../outside", "Documents/Vault/bad\0name", "Documents/Vault/back\\slash"] {
        XCTAssertThrowsError(try reader.info(home.appendingPathComponent(path).absoluteString))
      }
      for uri in ["https://example.invalid/file", "file://example.invalid" + root.path, root.absoluteString + "?query", root.absoluteString + "#fragment"] {
        XCTAssertThrowsError(try reader.info(uri))
      }
    }
  }

  func testSupportsDisposableCacheAndTemporaryWorkingCopies() throws {
    try withGitMetadataFixture { home, _ in
      let reader = try WorkspaceGitMetadata(home: home)
      for path in ["Library/Caches/Git Vault", "tmp/Git Vault"] {
        let directory = home.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        XCTAssertEqual(try reader.info(directory.absoluteString)["isDirectory"] as? Bool, true)
      }
      XCTAssertThrowsError(try reader.info(home.absoluteString))
    }
  }

  func testRejectsPathNormalizationAliasesAndFileAuthorities() throws {
    try withGitMetadataFixture { home, root in
      let reader = try WorkspaceGitMetadata(home: home)
      try Data("retained".utf8).write(to: root.appendingPathComponent("note.md"))
      for suffix in ["/./note.md", "/../Vault/note.md", "//note.md", "/%2E%2E/Vault/note.md"] {
        XCTAssertThrowsError(try reader.info(root.absoluteString + suffix), suffix)
      }
      for authority in ["user@localhost", "user:secret@localhost", "localhost:1234"] {
        XCTAssertThrowsError(try reader.info("file://" + authority + root.path + "/note.md"), authority)
      }
      XCTAssertEqual(try reader.info("file://localhost" + root.path + "/note.md")["size"] as? Int64, 8)
    }
  }
}

func withGitMetadataFixture(_ test: (URL, URL) throws -> Void) throws {
  let home = FileManager.default.temporaryDirectory.appendingPathComponent("memoria-git-metadata-\(UUID().uuidString)")
  let root = home.appendingPathComponent("Documents/Vault")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: home) }
  try test(home, root)
}
