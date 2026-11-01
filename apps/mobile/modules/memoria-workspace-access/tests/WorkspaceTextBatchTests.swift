import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceTextBatchTests: XCTestCase {
  func testRestartCompletesEveryTextAfterAnInterruptedFirstReplacement() throws {
    try withTextRecoveryFixture { root, journal in
      let changes = batchChanges()
      var interrupted = WorkspaceTextRecovery(root: root, journal: journal)
      interrupted.afterStage = { stage in if stage == .replaced { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try interrupted.writeBatch(changes, identifier: "batch-1"))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("first.md")), changes[0].content)
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("second.md").path))
      let restarted = WorkspaceTextRecovery(root: root, journal: journal)
      XCTAssertTrue(try restarted.recover())
      for change in changes {
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent(change.path)), change.content)
      }
      XCTAssertFalse(try restarted.recover())
    }
  }

  func testChecksEveryPreconditionBeforeReplayingAnyMember() throws {
    try withTextRecoveryFixture { root, journal in
      var interrupted = WorkspaceTextRecovery(root: root, journal: journal)
      interrupted.afterStage = { stage in if stage == .published { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try interrupted.writeBatch(batchChanges(), identifier: "batch-2"))
      let second = root.appendingPathComponent("second.md")
      try Data("external edit".utf8).write(to: second)
      let record = try Data(contentsOf: journal)
      XCTAssertThrowsError(try WorkspaceTextRecovery(root: root, journal: journal).recover())
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("first.md").path))
      XCTAssertEqual(try String(contentsOf: second), "external edit")
      XCTAssertEqual(try Data(contentsOf: journal), record)
    }
  }

  func testCompletedBatchRetryPreservesLaterEditsAndDeletions() throws {
    try withTextRecoveryFixture { root, journal in
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      try writer.writeBatch(batchChanges(), identifier: "batch-3")
      let first = root.appendingPathComponent("first.md")
      let second = root.appendingPathComponent("second.md")
      try Data("later edit".utf8).write(to: first)
      try FileManager.default.removeItem(at: second)
      try writer.writeBatch(batchChanges(), identifier: "batch-3")
      XCTAssertEqual(try String(contentsOf: first), "later edit")
      XCTAssertFalse(FileManager.default.fileExists(atPath: second.path))
      XCTAssertThrowsError(try writer.writeBatch([batchChanges()[0]], identifier: "batch-3"))
    }
  }

  func testRejectsEmptyDuplicateAndOverlappingPlansBeforePublishing() throws {
    try withTextRecoveryFixture { root, journal in
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      let first = batchChanges()[0]
      let invalid: [[WorkspaceTextChange]] = [
        [], [first, first], [first, .init(path: "first.md/child.md", content: "bad")],
        [first, .init(path: "first.md!.md", content: "between"), .init(path: "first.md/child.md", content: "bad")],
        [first, .init(path: "../outside.md", content: "bad")],
      ]
      for changes in invalid {
        XCTAssertThrowsError(try writer.writeBatch(changes, identifier: UUID().uuidString))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journal.path))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
      }
    }
  }

  func testAcknowledgesLegacySingleTextCompletionReceipt() throws {
    try withTextRecoveryFixture { root, journal in
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      let file = root.appendingPathComponent("note.md")
      try Data("later edit".utf8).write(to: file)
      let receipt: [String: Any] = [
        "version": 1, "identifier": "old-save", "path": "note.md", "digest": textRecoveryDigest(Data("old draft".utf8)),
      ]
      try JSONSerialization.data(withJSONObject: receipt).write(to: writer.receipt)
      try writer.write("note.md", content: "old draft", identifier: "old-save")
      XCTAssertEqual(try String(contentsOf: file), "later edit")
    }
  }

  func testConflictAfterPartialReplacementRetainsTheWholePlan() throws {
    try withTextRecoveryFixture { root, journal in
      var interrupted = WorkspaceTextRecovery(root: root, journal: journal)
      interrupted.afterStage = { stage in if stage == .replaced { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try interrupted.writeBatch(batchChanges(), identifier: "partial-conflict"))
      let first = root.appendingPathComponent("first.md")
      try Data("external edit after interruption".utf8).write(to: first)
      let record = try Data(contentsOf: journal)
      let restarted = WorkspaceTextRecovery(root: root, journal: journal)
      XCTAssertThrowsError(try restarted.recover())
      XCTAssertThrowsError(try restarted.write("later.md", content: "blocked"))
      XCTAssertEqual(try String(contentsOf: first), "external edit after interruption")
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("second.md").path))
      XCTAssertEqual(try Data(contentsOf: journal), record)
    }
  }

  func testRetainsIntentWhenCompletionReceiptCannotBePublished() throws {
    try withTextRecoveryFixture { root, journal in
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      var interrupted = writer
      interrupted.afterStage = { stage in
        if stage == .published { try FileManager.default.createDirectory(at: writer.receipt, withIntermediateDirectories: false) }
      }
      XCTAssertThrowsError(try interrupted.writeBatch(batchChanges(), identifier: "receipt-failure"))
      XCTAssertTrue(FileManager.default.fileExists(atPath: journal.path))
      try FileManager.default.removeItem(at: writer.receipt)
      XCTAssertTrue(try writer.recover())
      for change in batchChanges() {
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent(change.path)), change.content)
      }
      let receipt = try String(contentsOf: writer.receipt)
      XCTAssertFalse(receipt.contains("custom: retained"))
      XCTAssertFalse(receipt.contains("related:"))
    }
  }
}

private func batchChanges() -> [WorkspaceTextChange] {
  [
    .init(path: "first.md", content: "---\ncustom: retained\n---\n# First\n"),
    .init(path: "second.md", content: "---\nrelated: '[[first]]'\n---\n# Second\n"),
  ]
}
