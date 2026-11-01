import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class LinkedConflictTests: XCTestCase {
  func testReviewKeepBothAndContinuation() throws {
    try withConflict { fixture, session in
      let review = try session.reviewConflicts()
      XCTAssertEqual(review.files.map { $0.path }, ["note.md"])
      XCTAssertEqual(review.files.first?.local.text, "local edit")
      try fixture.write("other.md", "new edit", in: fixture.cache)
      XCTAssertThrowsError(try session.resolveConflicts(review, choices: ["note.md": "both"]))
      let fresh = try session.reviewConflicts()
      try session.resolveConflicts(fresh, choices: ["note.md": "both"])
      XCTAssertEqual(try fixture.read("note.md", in: fixture.source), "local edit")
      XCTAssertEqual(try fixture.read("note (conflict 1).md", in: fixture.source), "external edit")
      XCTAssertEqual(try fixture.read("other.md", in: fixture.source), "new edit")
      XCTAssertFalse(try session.sync())
    }
  }

  func testStaleRemoteAndIncompleteChoicesDoNotWrite() throws {
    try withConflict { fixture, session in
      let review = try session.reviewConflicts()
      XCTAssertThrowsError(try session.resolveConflicts(review, choices: [:]))
      try fixture.write("note.md", "new remote", in: fixture.source)
      XCTAssertThrowsError(try session.resolveConflicts(review, choices: ["note.md": "local"]))
      XCTAssertEqual(try fixture.read("note.md", in: fixture.cache), "local edit")
      XCTAssertEqual(try fixture.read("note.md", in: fixture.source), "new remote")
    }
  }

  func testRemoteChoiceBacksUpOriginalAndPreservesBinary() throws {
    try withConflict { fixture, session in
      let bytes = Data([0, 255, 12])
      try bytes.write(to: fixture.source.appendingPathComponent("note.md"))
      let review = try session.reviewConflicts()
      XCTAssertEqual(review.files.first?.remote.kind, "binary")
      try session.resolveConflicts(review, choices: ["note.md": "remote"])
      XCTAssertEqual(try Data(contentsOf: fixture.cache.appendingPathComponent("note.md")), bytes)
      let backups = fixture.state.deletingPathExtension().appendingPathExtension("resolutions")
      let names = try FileManager.default.contentsOfDirectory(atPath: backups.path)
      XCTAssertEqual(names.count, 1)
      XCTAssertEqual(try fixture.read(names[0] + "/local/note.md", in: backups), "local edit")
    }
  }

  func testDirectoryDeletionVersusNewChildKeepsBothAndAvoidsNameCollision() throws {
    let plan = try LinkedConflictPlan(base: ["folder": "directory", "folder/a.md": "a"],
      local: [:], remote: ["folder": "directory", "folder/a.md": "a", "folder/new.md": "new"])
    XCTAssertEqual(plan.conflicts, ["folder"])
    let resolved = try LinkedConflictPlan(base: ["item": "a"], local: ["item": "b", "item (conflict 1)": "existing"],
      remote: ["item": "directory", "item/child": "c"], choices: ["item": "both"])
    XCTAssertEqual(resolved.merged["item"], "b")
    XCTAssertEqual(resolved.merged["item (conflict 2)/child"], "c")
    XCTAssertEqual(resolved.merged["item (conflict 1)"], "existing")
  }

  func testInterruptedPublicationResumesWithoutRepeatingChoices() throws {
    try withConflict { fixture, session in
      let review = try session.reviewConflicts()
      let plan = try LinkedConflictPlan(base: review.base, local: review.local, remote: review.remote, choices: ["note.md": "both"])
      let publication = LinkedConflictPublication(stateFile: fixture.state)
      try publication.prepare(plan, review: review, local: LinkedWorkspaceTree(root: fixture.cache), remote: LinkedWorkspaceTree(root: fixture.source))
      try fixture.write("note.md", "local edit", in: fixture.source)
      XCTAssertTrue(try LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state).sync())
      XCTAssertEqual(try fixture.read("note (conflict 1).md", in: fixture.cache), "external edit")
      XCTAssertFalse(publication.pending)
      XCTAssertFalse(try session.sync())
    }
  }

  func testInterruptedPublicationDoesNotOverwriteLaterEditsAndCanBeReviewedAgain() throws {
    try withConflict { fixture, session in
      let review = try session.reviewConflicts()
      let plan = try LinkedConflictPlan(base: review.base, local: review.local, remote: review.remote, choices: ["note.md": "local"])
      let publication = LinkedConflictPublication(stateFile: fixture.state)
      try publication.prepare(plan, review: review, local: LinkedWorkspaceTree(root: fixture.cache), remote: LinkedWorkspaceTree(root: fixture.source))
      try fixture.write("note.md", "late remote", in: fixture.source)
      XCTAssertThrowsError(try session.sync())
      XCTAssertEqual(try fixture.read("note.md", in: fixture.source), "late remote")
      try session.resolveConflicts(session.reviewConflicts(), choices: ["note.md": "both"])
      XCTAssertEqual(try fixture.read("note (conflict 1).md", in: fixture.cache), "late remote")
    }
  }

  private func withConflict(_ action: (LinkedWorkspaceFixture, LinkedWorkspaceSession) throws -> Void) throws {
    try withDisposableWorkspace { root in
      let fixture = try LinkedWorkspaceFixture(root: root)
      try fixture.write("note.md", "original", in: fixture.source)
      let session = LinkedWorkspaceSession(cache: fixture.cache, stateFile: fixture.state)
      try session.connect(source: fixture.source)
      try fixture.write("note.md", "local edit", in: fixture.cache)
      try fixture.write("note.md", "external edit", in: fixture.source)
      try action(fixture, session)
    }
  }
}
