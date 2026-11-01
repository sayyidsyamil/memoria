import XCTest
@testable import MemoriaWorkspaceFiles

final class LinkedWorkspacePlanTests: XCTestCase {
  func testMergesIndependentChangesAndDeletions() throws {
    let base = ["edited.md": "old", "removed.md": "old", "incoming.md": "old"]
    let local = ["edited.md": "local", "incoming.md": "old"]
    let external = ["edited.md": "old", "removed.md": "old", "incoming.md": "external"]
    let plan = try LinkedWorkspacePlan(base: base, local: local, external: external)
    XCTAssertEqual(plan.merged, ["edited.md": "local", "incoming.md": "external"])
  }

  func testRejectsConflictingEditsAndDeleteVersusEdit() {
    XCTAssertThrowsError(try LinkedWorkspacePlan(base: ["a": "old"], local: ["a": "left"], external: ["a": "right"]))
    XCTAssertThrowsError(try LinkedWorkspacePlan(base: ["a": "old"], local: [:], external: ["a": "right"]))
    XCTAssertThrowsError(try LinkedWorkspacePlan(base: [:], local: ["a": "left"], external: ["a": "right"]))
  }

  func testDeletedDirectoryCannotEraseNewOrEditedChildren() {
    let base = ["folder": "directory", "folder/note.md": "old"]
    let changed = ["folder": "directory", "folder/note.md": "new"]
    XCTAssertThrowsError(try LinkedWorkspacePlan(base: base, local: changed, external: [:]))
    XCTAssertThrowsError(try LinkedWorkspacePlan(base: ["folder": "directory"], local: [:], external: changed))
  }

  func testAlreadyAppliedChangesConvergeAfterInterruptedSync() throws {
    let plan = try LinkedWorkspacePlan(base: ["a": "old"], local: ["a": "new"], external: ["a": "new"])
    XCTAssertEqual(plan.merged, ["a": "new"])
  }
}
