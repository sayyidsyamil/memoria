import XCTest

final class MobileSettingsOrientationTests: XCTestCase {
  func testSettingsPreservesLandscapeAndRemainsDismissible() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=settings-orientation"]
    XCUIDevice.shared.orientation = .landscapeLeft
    defer {
      app.terminate()
      XCUIDevice.shared.orientation = .portrait
    }
    app.launch()
    let settings = app.descendants(matching: .any).matching(identifier: "open-mobile-settings").firstMatch
    XCTAssertTrue(settings.waitForExistence(timeout: 30))

    for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight] {
      XCUIDevice.shared.orientation = orientation
      assertLandscape(app)
      settings.tap()
      let close = app.buttons["Close settings"]
      XCTAssertTrue(close.waitForExistence(timeout: 5))
      assertLandscape(app)
      XCTAssertTrue(close.isHittable)
      close.tap()
      XCTAssertTrue(close.waitForNonExistence(timeout: 5))
      assertLandscape(app)
    }
  }

  private func assertLandscape(_ app: XCUIApplication) {
    let landscape = NSPredicate { _, _ in app.frame.width > app.frame.height }
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: app)], timeout: 5), .completed,
      "Opening Settings must preserve the landscape workspace")
  }
}
