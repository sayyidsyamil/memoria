import Foundation
import XCTest
@testable import MemoriaWorkspaceFiles

final class LinkedConflictRetentionTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_790_000_000)
  private let day: TimeInterval = 86_400

  func testPrunesOnlyOlderCompletedBackupsBeyondTheLatestThree() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      var completed: [URL] = []
      for index in 0..<5 {
        completed.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 12) * day)).directory)
      }
      XCTAssertEqual(try publication.pruneCompletedBackups(now: now), 2)
      XCTAssertFalse(exists(completed[0]))
      XCTAssertFalse(exists(completed[1]))
      for directory in completed.suffix(3) { XCTAssertTrue(exists(directory)) }
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("local/note.md")), "local")
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("remote/note.md")), "local")
    }
  }

  func testKeepsEveryRecentCompletionAndIsIdempotent() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      var completed: [URL] = []
      for index in 0..<5 {
        completed.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 6) * day)).directory)
      }
      XCTAssertEqual(try publication.pruneCompletedBackups(now: now), 0)
      for directory in completed { XCTAssertTrue(exists(directory)) }
      XCTAssertEqual(try publication.pruneCompletedBackups(now: now.addingTimeInterval(20 * day)), 2)
      XCTAssertEqual(try publication.pruneCompletedBackups(now: now.addingTimeInterval(20 * day)), 0)
    }
  }

  func testPendingJournalProtectsEvenAnOldCompletedDirectory() throws {
    try withDisposableWorkspace { root in
      let state = root.appendingPathComponent("state.json")
      let publication = LinkedConflictPublication(stateFile: state)
      let first = try finishResolution(root, publication, at: now.addingTimeInterval(-20 * day))
      for index in 0..<4 { _ = try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 19) * day)) }
      try first.journal.write(to: state.appendingPathExtension("resolution.json"))
      _ = try publication.pruneCompletedBackups(now: now)
      XCTAssertTrue(exists(first.directory))
      XCTAssertTrue(publication.pending)
      try publication.finish(now: now)
      XCTAssertFalse(publication.pending)
      XCTAssertTrue(exists(first.directory))
    }
  }

  func testUnmarkedCorruptSupersededAndUnexpectedBackupsAreRetained() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      var protected: [URL] = []
      for index in 0..<7 {
        protected.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 20) * day)).directory)
      }
      try FileManager.default.removeItem(at: protected[0].appendingPathComponent("completed.json"))
      try Data("broken".utf8).write(to: protected[1].appendingPathComponent("completed.json"))
      try Data().write(to: protected[2].appendingPathComponent("superseded.json"))
      try Data("unknown".utf8).write(to: protected[3].appendingPathComponent("unknown.md"))
      _ = try publication.pruneCompletedBackups(now: now)
      for directory in protected { XCTAssertTrue(exists(directory)) }
    }
  }

  func testSymlinkedBackupsAndCompletionMarkersAreNotFollowed() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      let first = try finishResolution(root, publication, at: now.addingTimeInterval(-20 * day)).directory
      let outside = root.appendingPathComponent("outside")
      try FileManager.default.moveItem(at: first, to: outside)
      try FileManager.default.createSymbolicLink(at: first, withDestinationURL: outside)
      let second = try finishResolution(root, publication, at: now.addingTimeInterval(-19 * day)).directory
      let marker = second.appendingPathComponent("completed.json")
      let externalMarker = root.appendingPathComponent("external-marker.json")
      try FileManager.default.moveItem(at: marker, to: externalMarker)
      try FileManager.default.createSymbolicLink(at: marker, withDestinationURL: externalMarker)
      for index in 0..<3 { _ = try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 18) * day)) }
      _ = try publication.pruneCompletedBackups(now: now)
      XCTAssertTrue(exists(first))
      XCTAssertTrue(exists(second))
      XCTAssertTrue(exists(outside.appendingPathComponent("local/note.md")))
      XCTAssertTrue(exists(externalMarker))
    }
  }

  func testFinishingAnotherResolutionPrunesOldCompletedBackupsAutomatically() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      var old: [URL] = []
      for index in 0..<4 {
        old.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 20) * day)).directory)
      }
      let newest = try finishResolution(root, publication, at: now).directory
      XCTAssertFalse(exists(old[0]))
      XCTAssertFalse(exists(old[1]))
      for directory in old.suffix(2) + [newest] { XCTAssertTrue(exists(directory)) }
    }
  }

  func testCorruptPendingJournalBlocksAllCleanup() throws {
    try withDisposableWorkspace { root in
      let state = root.appendingPathComponent("state.json")
      let publication = LinkedConflictPublication(stateFile: state)
      var old: [URL] = []
      for index in 0..<4 {
        old.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 20) * day)).directory)
      }
      try Data("broken".utf8).write(to: state.appendingPathExtension("resolution.json"))
      XCTAssertThrowsError(try publication.pruneCompletedBackups(now: now))
      for directory in old { XCTAssertTrue(exists(directory)) }
    }
  }

  func testNestedSymlinkAndFutureOrMismatchedReceiptsAreRetained() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      var old: [URL] = []
      for index in 0..<6 {
        old.append(try finishResolution(root, publication, at: now.addingTimeInterval(Double(index - 20) * day)).directory)
      }
      let target = root.appendingPathComponent("must-survive.md")
      try Data("preserved".utf8).write(to: target)
      try FileManager.default.createSymbolicLink(at: old[0].appendingPathComponent("local/link.md"), withDestinationURL: target)
      try replaceReceipt(old[1], identifier: UUID().uuidString, date: now)
      try replaceReceipt(old[2], identifier: old[2].lastPathComponent, date: now.addingTimeInterval(day))
      _ = try publication.pruneCompletedBackups(now: now)
      for directory in old { XCTAssertTrue(exists(directory)) }
      XCTAssertEqual(try String(contentsOf: target), "preserved")
    }
  }

  func testMissingBackupRootIsAnEmptyCleanup() throws {
    try withDisposableWorkspace { root in
      XCTAssertEqual(try LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json")).pruneCompletedBackups(now: now), 0)
    }
  }

  func testFailedCompletionMarkerDoesNotFailTheSavedResolution() throws {
    try withDisposableWorkspace { root in
      let publication = LinkedConflictPublication(stateFile: root.appendingPathComponent("state.json"))
      let completed = try finishResolution(root, publication, at: now, beforeFinish: { directory in
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("completed.json"), withIntermediateDirectories: false)
      })
      XCTAssertFalse(publication.pending)
      XCTAssertTrue(exists(completed.directory))
      XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("remote/note.md")), "local")
    }
  }

  private func replaceReceipt(_ directory: URL, identifier: String, date: Date) throws {
    let marker = directory.appendingPathComponent("completed.json")
    let data = try JSONSerialization.data(withJSONObject: ["version": 1, "identifier": identifier,
      "completedAt": date.timeIntervalSinceReferenceDate])
    try data.write(to: marker, options: .atomic)
  }

  private func finishResolution(_ root: URL, _ publication: LinkedConflictPublication, at date: Date,
    beforeFinish: (URL) throws -> Void = { _ in }) throws -> (directory: URL, journal: Data) {
    let local = LinkedWorkspaceTree(root: root.appendingPathComponent("local"))
    let remote = LinkedWorkspaceTree(root: root.appendingPathComponent("remote"))
    for tree in [local, remote] { try FileManager.default.createDirectory(at: tree.root, withIntermediateDirectories: true) }
    try Data("local".utf8).write(to: local.root.appendingPathComponent("note.md"))
    try Data("remote".utf8).write(to: remote.root.appendingPathComponent("note.md"))
    let review = LinkedConflictReview(base: ["note.md": "original"], local: try local.snapshot(), remote: try remote.snapshot(), files: [])
    let plan = try LinkedConflictPlan(base: review.base, local: review.local, remote: review.remote, choices: ["note.md": "local"])
    try publication.prepare(plan, review: review, local: local, remote: remote)
    let journal = try Data(contentsOf: root.appendingPathComponent("state.json.resolution.json"))
    let record = try XCTUnwrap(JSONSerialization.jsonObject(with: journal) as? [String: Any])
    let identifier = try XCTUnwrap(record["identifier"] as? String)
    let directory = root.appendingPathComponent("state.resolutions").appendingPathComponent(identifier)
    _ = try publication.apply(local: local, remote: remote)
    try beforeFinish(directory)
    try publication.finish(now: date)
    return (directory, journal)
  }

  private func exists(_ url: URL) -> Bool { FileManager.default.fileExists(atPath: url.path) }
}
