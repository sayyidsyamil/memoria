import Foundation
import XCTest
@testable import MemoriaCrashPrivacy

final class NativeCrashCacheTests: XCTestCase {
  func testRetainsCrashAcrossLaunchButNeverAcrossConsentRevocation() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "MemoriaCrashCacheTest-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
    let cache = NativeCrashCache(root: root, defaults: defaults)
    let first = try cache.directory()
    try Data("test report".utf8).write(to: first.appendingPathComponent("pending"))
    XCTAssertEqual(try NativeCrashCache(root: root, defaults: defaults).directory(), first)
    try cache.revoke()
    XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
    XCTAssertNotEqual(try cache.directory(), first)
  }
}
