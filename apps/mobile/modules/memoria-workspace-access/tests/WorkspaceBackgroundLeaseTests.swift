import XCTest
@testable import MemoriaWorkspaceFiles

final class WorkspaceBackgroundLeaseTests: XCTestCase {
  func testCompletionEndsEachLeaseOnce() {
    var ended: [Int] = []
    let lease = WorkspaceBackgroundLease { ended.append($0) }
    XCTAssertTrue(lease.begin("first", request: { _ in 1 }, expired: {}))
    XCTAssertFalse(lease.begin("second", request: { _ in 2 }, expired: {}))
    XCTAssertFalse(lease.end("second"))
    XCTAssertTrue(lease.end("first"))
    XCTAssertFalse(lease.end("first"))
    XCTAssertEqual(ended, [1])
  }

  func testExpirationEndsLeaseEvenWithoutJavaScript() {
    var ended: [Int] = []
    var expire = {}
    var notifications = 0
    let lease = WorkspaceBackgroundLease { ended.append($0) }
    XCTAssertTrue(lease.begin("first", request: { callback in expire = callback; return 1 }, expired: { notifications += 1 }))
    expire()
    XCTAssertEqual(ended, [1])
    XCTAssertEqual(notifications, 1)
    XCTAssertFalse(lease.end("first"))
    XCTAssertTrue(lease.begin("second", request: { _ in 2 }, expired: {}))
    expire()
    XCTAssertEqual(notifications, 1)
    lease.endAll()
    XCTAssertEqual(ended, [1, 2])
  }

  func testDeniedAndImmediatelyExpiredRequestsDoNotLeakTokens() {
    var ended: [Int] = []
    let lease = WorkspaceBackgroundLease { ended.append($0) }
    XCTAssertFalse(lease.begin("denied", request: { _ in nil }, expired: {}))
    XCTAssertFalse(lease.begin("expired", request: { expire in expire(); return 7 }, expired: {}))
    XCTAssertEqual(ended, [7])
    XCTAssertTrue(lease.begin("next", request: { _ in 8 }, expired: {}))
    lease.endAll()
    XCTAssertEqual(ended, [7, 8])
  }
}
