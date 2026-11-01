import XCTest

final class TabletPrivacyTests: XCTestCase {
  func testUsageConsentPersistsAndCanBeRevoked() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=privacy"]
    app.launch()
    openSettings(app)
    let consent = element(app, "settings-analytics")
    XCTAssertTrue(consent.waitForExistence(timeout: 5))
    XCTAssertEqual(consent.value as? String, "0")
    consent.tap()
    assertConsent(consent, enabled: true)
    app.buttons["Close settings"].tap()
    app.terminate()
    app.launch()
    openSettings(app)
    let persisted = element(app, "settings-analytics")
    assertConsent(persisted, enabled: true)
    persisted.tap()
    assertConsent(persisted, enabled: false)
    app.buttons["Close settings"].tap()
  }

  private func openSettings(_ app: XCUIApplication) {
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
  }

  private func assertConsent(_ toggle: XCUIElement, enabled: Bool) {
    let predicate = NSPredicate(format: "value == %@", enabled ? "1" : "0")
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: toggle)], timeout: 5), .completed)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
