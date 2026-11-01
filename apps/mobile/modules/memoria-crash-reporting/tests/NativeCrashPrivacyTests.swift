import Foundation
import Sentry
import XCTest
@testable import MemoriaCrashPrivacy

final class NativeCrashPrivacyTests: XCTestCase {
  func testRebuildsEventWithoutUserContentAndPreservesSymbolicationAddresses() throws {
    let event = Event(level: .fatal)
    event.message = SentryMessage(formatted: "private note body")
    event.extra = ["secret": "private token"]
    event.tags = ["vault": "private vault"]
    event.context = ["device": ["name": "private owner"]]
    let frame = Frame()
    frame.instructionAddress = "0x100001234"
    frame.imageAddress = "0x100000000"
    frame.function = "private dynamic symbol"
    frame.fileName = "/private/vault/note.md"
    frame.vars = ["note": "private note body"]
    let exception = Exception(value: "private note body", type: "PrivateException")
    exception.stacktrace = SentryStacktrace(frames: [frame], registers: ["x0": "private"])
    event.exceptions = [exception]
    let clean = NativeCrashPrivacy.sanitize(event, context: context())
    let json = try XCTUnwrap(String(bytes: JSONSerialization.data(withJSONObject: clean.serialize()), encoding: .utf8))
    XCTAssertFalse(json.contains("private"))
    XCTAssertFalse(json.contains("PrivateException"))
    XCTAssertTrue(json.contains("0x100001234"))
    XCTAssertEqual(clean.releaseName, "memoria-mobile@1.0.0+42")
    XCTAssertEqual(clean.tags?["app_surface"], "mobile")
    XCTAssertEqual(clean.tags?["device_family"], "tablet")
  }

  func testRejectsUntrustedMetadataAndBoundsThreadPayload() {
    let event = Event(level: .fatal)
    event.threads = (0..<100).map { SentryThread(threadId: NSNumber(value: $0)) }
    let context = NativeCrashContext(["app_version": "private note", "device_family": "private vault"])
    let clean = NativeCrashPrivacy.sanitize(event, context: context)
    XCTAssertEqual(clean.threads?.count, 32)
    XCTAssertEqual(clean.tags?["device_family"], "unknown")
    XCTAssertEqual(clean.releaseName, "memoria-mobile@0+0")
  }

  func testConsentLeasesCannotResurrectARevokedSession() {
    let consent = NativeCrashConsent()
    XCTAssertFalse(consent.allows(0))
    let first = consent.activate()
    XCTAssertTrue(consent.allows(first))
    consent.revoke()
    XCTAssertFalse(consent.allows(first))
    let second = consent.activate()
    XCTAssertTrue(consent.allows(second))
    XCTAssertFalse(consent.allows(first))
  }

  func testThreadLimitRetainsTheCrashedThread() {
    let event = Event(level: .fatal)
    let threads = (0..<100).map { SentryThread(threadId: NSNumber(value: $0)) }
    threads[99].crashed = true
    event.threads = threads
    let clean = NativeCrashPrivacy.sanitize(event, context: context())
    XCTAssertEqual(clean.threads?.count, 32)
    XCTAssertTrue(clean.threads?.contains { $0.threadId == 99 && $0.crashed == true } == true)
  }

  func testCrashFromPreviousBinaryKeepsItsBuildAfterAnUpdate() {
    let event = Event(level: .fatal)
    event.releaseName = "memoria-mobile@0.9.0+41"
    let clean = NativeCrashPrivacy.sanitize(event, context: context())
    XCTAssertEqual(clean.releaseName, "memoria-mobile@0.9.0+41")
    XCTAssertEqual(clean.tags?["build_number"], "41")
    XCTAssertEqual(clean.dist, "41")
  }

  private func context() -> NativeCrashContext {
    NativeCrashContext(["app_version": "1.0.0", "build_number": "42", "device_family": "tablet",
      "release_channel": "alpha", "distribution": "testflight"])
  }
}
