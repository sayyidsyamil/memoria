import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceFileIndexTests: XCTestCase {
  func testInvalidTextFailsInsteadOfBecomingAnEmptyNote() throws {
    try withDisposableWorkspace { root in
      let note = root.appendingPathComponent("note.md")
      let bytes = Data([0xFF, 0xFE, 0xFF])
      try bytes.write(to: note)
      XCTAssertThrowsError(try WorkspaceFileIndex(root: root).read())
      XCTAssertEqual(try Data(contentsOf: note), bytes)
    }
  }

  func testVisibleSymlinksAreRejected() throws {
    try withDisposableWorkspace { root in
      let target = root.appendingPathComponent("target.md")
      try Data("target".utf8).write(to: target)
      try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link.md"), withDestinationURL: target)
      XCTAssertThrowsError(try WorkspaceFileIndex(root: root).read())
    }
  }

  func testMissingRootDoesNotReturnAnEmptyVault() throws {
    try withDisposableWorkspace { root in
      XCTAssertThrowsError(try WorkspaceFileIndex(root: root.appendingPathComponent("missing")).read())
    }
  }

  func testPreservesEmptyNotesAndBinaryEntries() throws {
    try withDisposableWorkspace { root in
      try Data().write(to: root.appendingPathComponent("empty.md"))
      try Data([255, 0, 128]).write(to: root.appendingPathComponent("image.png"))
      let index = try WorkspaceFileIndex(root: root).read()
      let files = try XCTUnwrap(index["files"] as? [[String: Any]])
      XCTAssertEqual(files.count, 2)
      XCTAssertTrue(files.allSatisfy { $0["content"] as? String == "" })
      XCTAssertEqual(files.first { $0["relativePath"] as? String == "image.png" }?["size"] as? Int, 3)
    }
  }

  func testStagingIndexPublishesFinalPathsAndSkipsInternalDirectories() throws {
    try withDisposableWorkspace { root in
      for path in ["Notes", ".git", "node_modules"] {
        let directory = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        try Data("# Note".utf8).write(to: directory.appendingPathComponent("a # %.md"))
      }
      let published = root.deletingLastPathComponent().appendingPathComponent("published")
      let json = try WorkspaceFileIndex(root: root, publishedRoot: published).json()
      let index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
      XCTAssertEqual(index["directories"] as? [String], ["Notes"])
      let files = try XCTUnwrap(index["files"] as? [[String: Any]])
      XCTAssertEqual(files.count, 1)
      XCTAssertEqual(files.first?["content"] as? String, "# Note")
      XCTAssertEqual(files.first?["absolutePath"] as? String, published.appendingPathComponent("Notes/a # %.md").absoluteString)
    }
  }

  func testContentDigestChangesForSameLengthEditsWithAnUnchangedTimestamp() throws {
    try withDisposableWorkspace { root in
      let url = root.appendingPathComponent("note.md")
      try Data("abcd".utf8).write(to: url)
      let timestamp = Date(timeIntervalSince1970: 1_700_000_000)
      try FileManager.default.setAttributes([.modificationDate: timestamp], ofItemAtPath: url.path)
      let first = try indexFile(root, path: "note.md")
      XCTAssertEqual(first["contentDigest"] as? String, "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589")
      try Data("abce".utf8).write(to: url)
      try FileManager.default.setAttributes([.modificationDate: timestamp], ofItemAtPath: url.path)
      let second = try indexFile(root, path: "note.md")
      XCTAssertEqual(first["size"] as? Int, second["size"] as? Int)
      XCTAssertEqual(first["modifiedAt"] as? Double, second["modifiedAt"] as? Double)
      XCTAssertNotEqual(first["contentDigest"] as? String, second["contentDigest"] as? String)
      XCTAssertEqual(second["content"] as? String, "abce")
    }
  }

  func testEmptyAndBinarySnapshotTextHaveTheKnownEmptyDigest() throws {
    try withDisposableWorkspace { root in
      try Data().write(to: root.appendingPathComponent("empty.md"))
      try Data([255, 0, 128]).write(to: root.appendingPathComponent("image.png"))
      for path in ["empty.md", "image.png"] {
        let entry = try indexFile(root, path: path)
        XCTAssertEqual(entry["content"] as? String, "")
        XCTAssertEqual(entry["contentDigest"] as? String, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
      }
    }
  }

  private func indexFile(_ root: URL, path: String) throws -> [String: Any] {
    let files = try XCTUnwrap(WorkspaceFileIndex(root: root).read()["files"] as? [[String: Any]])
    return try XCTUnwrap(files.first { $0["relativePath"] as? String == path })
  }
}
