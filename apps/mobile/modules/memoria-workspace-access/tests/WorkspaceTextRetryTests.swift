import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceTextRetryTests: XCTestCase {
  func testRecoveredRetryDoesNotOverwriteALaterEditOrResurrectADeletion() throws {
    try withTextRecoveryFixture { root, journal in
      let file = root.appendingPathComponent("note.md")
      try Data("before".utf8).write(to: file)
      var interrupted = WorkspaceTextRecovery(root: root, journal: journal)
      interrupted.afterStage = { stage in if stage == .published { throw RecoveryTestFailure.interrupted } }
      XCTAssertThrowsError(try interrupted.write("note.md", content: "draft", identifier: "save-1"))
      let restarted = WorkspaceTextRecovery(root: root, journal: journal)
      XCTAssertTrue(try restarted.recover())
      try Data("later external edit".utf8).write(to: file)
      try restarted.write("note.md", content: "draft", identifier: "save-1")
      XCTAssertEqual(try String(contentsOf: file), "later external edit")
      try FileManager.default.removeItem(at: file)
      try restarted.write("note.md", content: "draft", identifier: "save-1")
      XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
  }

  func testNewCommandCanWriteButReusingAnIdentityForAnotherPayloadIsRejected() throws {
    try withTextRecoveryFixture { root, journal in
      let writer = WorkspaceTextRecovery(root: root, journal: journal)
      try writer.write("note.md", content: "first", identifier: "save-1")
      XCTAssertThrowsError(try writer.write("note.md", content: "different", identifier: "save-1"))
      XCTAssertThrowsError(try writer.write("other.md", content: "first", identifier: "save-1"))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("note.md")), "first")
      XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("other.md").path))
      try writer.write("note.md", content: "new command", identifier: "save-2")
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("note.md")), "new command")
    }
  }

  func testOlderPublishedRecordsStillRecoverWithoutAnIdentifier() throws {
    try withTextRecoveryFixture { root, journal in
      let file = root.appendingPathComponent("note.md")
      try Data("before".utf8).write(to: file)
      let record: [String: Any] = [
        "version": 1, "path": "note.md", "before": textRecoveryDigest(Data("before".utf8)),
        "content": Data("legacy draft".utf8).base64EncodedString(),
      ]
      try JSONSerialization.data(withJSONObject: record).write(to: journal)
      XCTAssertTrue(try WorkspaceTextRecovery(root: root, journal: journal).recover())
      XCTAssertEqual(try String(contentsOf: file), "legacy draft")
    }
  }
}
