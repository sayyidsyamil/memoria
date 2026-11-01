import XCTest

final class TabletCrashPrivacyTests: XCTestCase {
  func testCrashConsentIsIndependentAndPersists() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=crash-privacy"]
    app.launch()
    openSettings(app)
    let crash = element(app, "settings-crash-reporting")
    let analytics = element(app, "settings-analytics")
    XCTAssertEqual(crash.value as? String, "0")
    XCTAssertEqual(analytics.value as? String, "0")
    crash.tap()
    assertConsent(crash, enabled: true)
    XCTAssertEqual(analytics.value as? String, "0")
    app.buttons["Close settings"].tap()
    app.terminate()
    app.launch()
    openSettings(app)
    assertConsent(element(app, "settings-crash-reporting"), enabled: true)
    XCTAssertEqual(element(app, "settings-analytics").value as? String, "0")
    element(app, "settings-crash-reporting").tap()
    assertConsent(element(app, "settings-crash-reporting"), enabled: false)
    app.buttons["Close settings"].tap()
  }

  private func openSettings(_ app: XCUIApplication) {
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    XCTAssertTrue(element(app, "settings-crash-reporting").waitForExistence(timeout: 5))
  }

  private func assertConsent(_ toggle: XCUIElement, enabled: Bool) {
    let predicate = NSPredicate(format: "value == %@", enabled ? "1" : "0")
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: toggle)], timeout: 5), .completed)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
