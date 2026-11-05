import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class LinkedWorkspaceSyncTests: XCTestCase {
  func testImportWriteBackAndPullSurviveNewSession() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("notes/a.md", "---\ntype: Essay\n---\nOriginal", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      XCTAssertEqual(try fixture.read("notes/a.md", in: fixture.cache), "---\ntype: Essay\n---\nOriginal")
      try fixture.write("notes/a.md", "---\ntype: Essay\n---\nEdited", in: fixture.cache)
      XCTAssertFalse(try session.sync())
      XCTAssertEqual(try fixture.read("notes/a.md", in: fixture.source), "---\ntype: Essay\n---\nEdited")
      try fixture.write("notes/a.md", "From another device", in: fixture.source)
      XCTAssertTrue(try LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state).sync())
      XCTAssertEqual(try fixture.read("notes/a.md", in: fixture.cache), "From another device")
    }
  }

  func testConflictPreservesBothVersionsAndUnrelatedFiles() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("note.md", "original", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      try fixture.write("note.md", "local edit", in: fixture.cache)
      try fixture.write("note.md", "external edit", in: fixture.source)
      try fixture.write("unrelated.md", "pending", in: fixture.cache)
      XCTAssertThrowsError(try session.sync())
      XCTAssertEqual(try fixture.read("note.md", in: fixture.cache), "local edit")
      XCTAssertEqual(try fixture.read("note.md", in: fixture.source), "external edit")
      XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.source.appendingPathComponent("unrelated.md").path))
    }
  }

  func testRenamesDeletionBinaryAndHiddenMetadataWithoutGit() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("folder/note.md", "original", in: fixture.source)
      try fixture.write(".memoria/config.json", "{}", in: fixture.source)
      try fixture.write(".git/config", "untouched", in: fixture.source)
      let bytes = Data([0, 255, 1, 254])
      try bytes.write(to: fixture.source.appendingPathComponent("image.png"))
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      try FileManager.default.moveItem(at: fixture.cache.appendingPathComponent("folder"), to: fixture.cache.appendingPathComponent("renamed"))
      try FileManager.default.removeItem(at: fixture.source.appendingPathComponent("image.png"))
      XCTAssertTrue(try session.sync())
      XCTAssertEqual(try fixture.read("renamed/note.md", in: fixture.source), "original")
      XCTAssertEqual(try fixture.read(".memoria/config.json", in: fixture.cache), "{}")
      XCTAssertEqual(try fixture.read(".git/config", in: fixture.source), "untouched")
      XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.cache.appendingPathComponent(".git").path))
      XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.cache.appendingPathComponent("image.png").path))
      XCTAssertFalse(try session.sync())
    }
  }

  func testMissingProviderDoesNotDeleteTheOfflineCopy() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("note.md", "offline content", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      try FileManager.default.removeItem(at: fixture.source)
      XCTAssertThrowsError(try session.sync())
      XCTAssertEqual(try fixture.read("note.md", in: fixture.cache), "offline content")
    }
  }
}
