import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class LinkedWorkspaceSafetyTests: XCTestCase {
  func testOnlyCurrentOrNonCloudFilesCanReconcile() {
    XCTAssertFalse(linkedWorkspaceRequiresDownload(nil))
    XCTAssertFalse(linkedWorkspaceRequiresDownload(.current))
    XCTAssertTrue(linkedWorkspaceRequiresDownload(.notDownloaded))
    XCTAssertTrue(linkedWorkspaceRequiresDownload(.downloaded))
  }

  func testCloudPlaceholderDoesNotDeleteCachedNoteOrAdvanceBaseline() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("note.md", "original", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      let baseline = try Data(contentsOf: fixture.state)
      try FileManager.default.moveItem(at: fixture.source.appendingPathComponent("note.md"), to: fixture.source.appendingPathComponent(".note.md.icloud"))
      XCTAssertThrowsError(try session.sync())
      XCTAssertEqual(try fixture.read("note.md", in: fixture.cache), "original")
      XCTAssertEqual(try Data(contentsOf: fixture.state), baseline)
      XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.cache.appendingPathComponent(".note.md.icloud").path))
    }
  }

  func testConflictRequestsEditorRefreshWithoutOverwritingEitherSide() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      let cache = root.appendingPathComponent("Documents/linked")
      let store = LinkedWorkspaceStore(home: root)
      try fixture.write("note.md", "original", in: fixture.source)
      _ = try store.connect(source: fixture.source, cache: cache)
      try fixture.write("note.md", "local edit", in: cache)
      try fixture.write("note.md", "external edit", in: fixture.source)
      let result = try store.sync(cache.absoluteString)
      XCTAssertEqual(result["conflict"], true)
      XCTAssertEqual(result["changed"], true)
      XCTAssertEqual(try fixture.read("note.md", in: cache), "local edit")
      XCTAssertEqual(try fixture.read("note.md", in: fixture.source), "external edit")
    }
  }

  func testSymlinkIsRejectedWithoutFollowingIt() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("outside.md", "private", in: root)
      try FileManager.default.createSymbolicLink(at: fixture.source.appendingPathComponent("link.md"), withDestinationURL: root.appendingPathComponent("outside.md"))
      XCTAssertThrowsError(try LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state).connect(source: fixture.source))
      XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.state.path))
      XCTAssertEqual(try fixture.read("outside.md", in: root), "private")
    }
  }

  func testNestedCacheIsRejected() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      let nested = fixture.source.appendingPathComponent("cache")
      XCTAssertThrowsError(try LinkedWorkspaceSession(cache: nested, stateFile: fixture.state).connect(source: fixture.source))
      XCTAssertFalse(FileManager.default.fileExists(atPath: nested.path))
    }
  }

  func testEqualConcurrentEditConvergesAndBinaryWriteBackPreservesBytes() throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("note.md", "original", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      try fixture.write("note.md", "same edit", in: fixture.source)
      try fixture.write("note.md", "same edit", in: fixture.cache)
      let bytes = Data([255, 0, 254, 1, 253])
      try bytes.write(to: fixture.cache.appendingPathComponent("image.png"))
      XCTAssertFalse(try session.sync())
      XCTAssertEqual(try Data(contentsOf: fixture.source.appendingPathComponent("image.png")), bytes)
      XCTAssertFalse(try session.sync())
    }
  }
}
