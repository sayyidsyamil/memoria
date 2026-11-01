import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceEntryRetryTests: XCTestCase {
  func testReadRecoveryThenQueueRetryDoesNotFailWithMissingSource() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("original".utf8).write(to: root.appendingPathComponent("note.md"))
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      var entries = writer.entryRecovery
      entries.afterStage = { stage in if stage == .published { throw RecoveryTestFailure.interrupted } }
      let change = WorkspaceEntryChange(path: "note.md", toPath: "renamed.md", directory: false)
      XCTAssertThrowsError(try entries.perform(change))
      XCTAssertTrue(try writer.recover())
      try writer.changeEntry(change)
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("renamed.md")), "original")
    }
  }

  func testRecognizedRetryDoesNotReplaceAnEditAtTheNewPath() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("original".utf8).write(to: root.appendingPathComponent("note.md"))
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal)
      let change = WorkspaceEntryChange(path: "note.md", toPath: "renamed.md", directory: false)
      try recovery.perform(change)
      try Data("external edit".utf8).write(to: root.appendingPathComponent("renamed.md"))
      try recovery.perform(change)
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("renamed.md")), "external edit")
    }
  }

  func testNewCommandsStillRejectMissingSourcesAndCollisions() throws {
    try withTextRecoveryFixture { root, journal in
      try Data("first".utf8).write(to: root.appendingPathComponent("note.md"))
      let recovery = WorkspaceEntryRecovery(root: root, journal: journal)
      let change = WorkspaceEntryChange(path: "note.md", toPath: "renamed.md", directory: false)
      try recovery.perform(change)
      XCTAssertThrowsError(try recovery.perform(.init(path: "note.md", toPath: "renamed.md", directory: false)))
      XCTAssertThrowsError(try recovery.perform(.init(path: "missing.md", toPath: "another.md", directory: false)))
      try Data("recreated".utf8).write(to: root.appendingPathComponent("note.md"))
      try recovery.perform(change)
      XCTAssertThrowsError(try recovery.perform(.init(path: "note.md", toPath: "renamed.md", directory: false)))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("note.md")), "recreated")
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("renamed.md")), "first")
    }
  }

  func testRetryAfterCommittedDeletionDoesNotDeleteARecreatedFile() throws {
    try withTextRecoveryFixture { root, journal in
      let file = root.appendingPathComponent("note.md")
      try Data("original".utf8).write(to: file)
      var interrupted = WorkspaceEntryRecovery(root: root, journal: journal)
      interrupted.afterStage = { stage in if stage == .committed { throw RecoveryTestFailure.interrupted } }
      let change = WorkspaceEntryChange(path: "note.md", toPath: nil, directory: false)
      XCTAssertThrowsError(try interrupted.perform(change))
      let restarted = WorkspaceEntryRecovery(root: root, journal: journal)
      _ = try restarted.recover()
      try Data("recreated after deletion".utf8).write(to: file)
      try restarted.perform(change)
      XCTAssertEqual(try String(contentsOf: file), "recreated after deletion")
    }
  }
}
