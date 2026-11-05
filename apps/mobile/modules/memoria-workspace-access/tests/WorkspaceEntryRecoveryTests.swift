import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceEntryRecoveryTests: XCTestCase {
  func testPublishedMoveReplaysAfterRestartWithoutOverwritingDestination() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("---\ncustom: retained\n---\n# Note\n".utf8).write(to: root.appendingPathComponent("old.md"))
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .published { throw RecoveryTestFailure.interrupted }
      })
      XCTAssertThrowsError(try recovery.perform(.init(path: "old.md", toPath: "folder/new.md", directory: false)))
      let restarted = WorkspaceEntryRecovery(root: root, journal: journal)
      XCTAssertTrue(try restarted.recover())
      XCTAssertFalse(try restarted.recover())
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("old.md").path))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("folder/new.md")), "---\ncustom: retained\n---\n# Note\n")
    }
  }

  func testCompletedMoveIsRecognizedAfterInterruption() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("content".utf8).write(to: root.appendingPathComponent("old.md"))
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .relocated { throw RecoveryTestFailure.interrupted }
      })
      XCTAssertThrowsError(try recovery.perform(.init(path: "old.md", toPath: "new.md", directory: false)))
      XCTAssertTrue(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("new.md")), "content")
    }
  }

  func testInterruptedDeleteKeepsTheVisibleTreeWholeAndRecoversCleanup() throws {
    for interruption in [WorkspaceEntryStage.published, .relocated] {
      try withTextRecoveryFixture { root, journal in
        try makeEntryRecoveryTree(root)
        let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
          if stage == interruption { throw RecoveryTestFailure.interrupted }
        })
        XCTAssertThrowsError(try recovery.perform(.init(path: "folder", toPath: nil, directory: true)))
        XCTAssertEqual(FileManager.default.fileExists(atPath: root.appendingPathComponent("folder/child/note.md").path), interruption == .published)
        XCTAssertTrue(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        XCTAssertEqual(Set(try FileManager.default.contentsOfDirectory(atPath: journal.deletingLastPathComponent().path)), ["vault", "pending.json.completed"])
      }
    }
  }

  func testChangedSourceBlocksReplayAndKeepsJournal() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("original".utf8).write(to: root.appendingPathComponent("old.md"))
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .published { throw RecoveryTestFailure.interrupted }
      })
      XCTAssertThrowsError(try recovery.perform(.init(path: "old.md", toPath: "new.md", directory: false)))
      try Data("external".utf8).write(to: root.appendingPathComponent("old.md"))
      XCTAssertThrowsError(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("old.md")), "external")
      XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("new.md").path))
    }
  }

  func testDestinationCollisionBeforeAndAfterPublicationPreservesBothFiles() throws {
    try withTextRecoveryFixture { root, journal in
      let source = root.appendingPathComponent("old.md")
      let destination = root.appendingPathComponent("new.md")
      try Data("original".utf8).write(to: source)
      let change = WorkspaceEntryChange(path: "old.md", toPath: "new.md", directory: false)
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal, afterStage: { stage in
        if stage == .published { try Data("collision".utf8).write(to: destination) }
      })
      XCTAssertThrowsError(try recovery.perform(change))
      XCTAssertThrowsError(try WorkspaceEntryRecovery(root: root, journal: journal).recover())
      XCTAssertEqual(try String(contentsOf: source), "original")
      XCTAssertEqual(try String(contentsOf: destination), "collision")
    }
  }
}

func makeEntryRecoveryTree(_ root: URL) throws {
  let directory = root.appendingPathComponent("folder/child")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  try Data("# Nested\n".utf8).write(to: directory.appendingPathComponent("note.md"))
  try Data([0, 255, 1, 2, 3]).write(to: directory.appendingPathComponent("image.bin"))
}
