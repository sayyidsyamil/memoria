import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceEntryRecoverySafetyTests: XCTestCase {
  func testUnsafePathsAndNestedDestinationsLeaveTreeUntouched() throws {
    try withTextRecoveryFixture { root, journal in
      try makeEntryRecoveryTree(root)
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal)
      for path in ["../escape", ".git", "folder/../escape"] {
        XCTAssertThrowsError(try recovery.perform(.init(path: path, toPath: nil, directory: true)))
      }
      XCTAssertThrowsError(try recovery.perform(.init(path: "folder", toPath: "folder/inside", directory: true)))
      XCTAssertThrowsError(try recovery.perform(.init(path: "folder", toPath: ".git/config", directory: true)))
      XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("folder/child/note.md").path))
      XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
    }
  }

  func testSymlinkInsideDeletedFolderIsNeverFollowed() throws {
    try withTextRecoveryFixture { root, journal in
      try makeEntryRecoveryTree(root)
      let outside = root.deletingLastPathComponent().appendingPathComponent("outside.md")
      try Data("external".utf8).write(to: outside)
      try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("folder/link"), withDestinationURL: outside)
      XCTAssertThrowsError(try WorkspaceEntryRecovery(root: root, journal: journal)
        .perform(.init(path: "folder", toPath: nil, directory: true)))
      XCTAssertEqual(try String(contentsOf: outside), "external")
      XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("folder/child/image.bin").path))
    }
  }

  func testModifiedNestedBinaryBlocksDeleteReplay() throws {
    try withTextRecoveryFixture { root, journal in
      try makeEntryRecoveryTree(root)
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .published { throw RecoveryTestFailure.interrupted }
      })
      XCTAssertThrowsError(try recovery.perform(.init(path: "folder", toPath: nil, directory: true)))
      let binary = root.appendingPathComponent("folder/child/image.bin")
      try Data([3, 2, 1, 255, 0]).write(to: binary)
      XCTAssertThrowsError(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
      XCTAssertEqual(try Data(contentsOf: binary), Data([3, 2, 1, 255, 0]))
      XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
    }
  }

  func testPostCommitCleanupCanResumeWithoutReopeningTheDeletedFolder() throws {
    try withTextRecoveryFixture { root, journal in
      try makeEntryRecoveryTree(root)
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .committed { throw RecoveryTestFailure.interrupted }
      })
      XCTAssertThrowsError(try recovery.perform(.init(path: "folder", toPath: nil, directory: true)))
      let retired = journal.appendingPathExtension("removed")
      XCTAssertTrue(FileManager.default.fileExists(atPath: retired.path))
      try FileManager.default.removeItem(at: retired.appendingPathComponent("child/image.bin"))
      XCTAssertFalse(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
      XCTAssertFalse(FileManager.default.fileExists(atPath: retired.path))
      XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }
  }

  func testPendingEntryBlocksTextWritesDuringGitCheckout() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("original".utf8).write(to: root.appendingPathComponent("note.md"))
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      var entries = writer.entryRecovery
      entries.afterStage = { stage in if stage == .published { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try entries.perform(.init(path: "note.md", toPath: "renamed.md", directory: false)))
      let git = root.appendingPathComponent(".git")
      try FileManager.default.createDirectory(at: git, withIntermediateDirectories: true)
      try Data("pending".utf8).write(to: git.appendingPathComponent("memoria-checkout.json"))
      XCTAssertThrowsError(try writer.recover())
      XCTAssertThrowsError(try writer.write("later.md", content: "later"))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("note.md")), "original")
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("later.md").path))
    }
  }

  func testUnifiedRecoveryReplaysMoveBeforeTheNextTextSave() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("original".utf8).write(to: root.appendingPathComponent("note.md"))
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      var entries = writer.entryRecovery
      entries.afterStage = { stage in if stage == .published { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try entries.perform(.init(path: "note.md", toPath: "renamed.md", directory: false)))
      try writer.write("renamed.md", content: "newest")
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("renamed.md")), "newest")
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("note.md").path))
      XCTAssertFalse(try writer.recover())
    }
  }
}
