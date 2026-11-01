import XCTest

final class TabletSyncConflictTests: XCTestCase {
  func testReviewKeepBothAndHistorySurviveRelaunch() throws {
    guard ProcessInfo.processInfo.environment["MEMORIA_QA_SYNC_CONFLICT"] == "1" else { throw XCTSkip("Requires isolated sync-conflict fixture") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&editorMode=wysiwyg"]
    app.launch()
    openManager(app)
    XCTAssertTrue(app.staticTexts["Sync Conflict QA"].firstMatch.waitForExistence(timeout: 10))
    let reviewButton = app.buttons["review-sync-conflicts"].firstMatch
    XCTAssertTrue(reviewButton.waitForExistence(timeout: 10))
    reviewButton.tap()
    let review = element(app, "sync-conflict-review")
    XCTAssertTrue(review.waitForExistence(timeout: 30))
    assertVisible(app, text: "Local conflict body")
    assertVisible(app, text: "Remote conflict body")
    let apply = app.buttons["conflict-apply"].firstMatch
    XCTAssertFalse(apply.isEnabled)
    let both = app.buttons["conflict-choice-both"].firstMatch
    XCTAssertGreaterThanOrEqual(both.frame.height, 44)
    XCTAssertTrue(both.isHittable)
    both.tap()
    XCTAssertTrue(apply.isEnabled)
    capture(app)
    apply.tap()
    expectation(for: NSPredicate { _, _ in !review.exists }, evaluatedWith: nil)
    waitForExpectations(timeout: 30)
    XCTAssertTrue(localCommit(app).waitForExistence(timeout: 10))
    app.terminate()
    app.launch()
    openManager(app)
    XCTAssertTrue(localCommit(app).waitForExistence(timeout: 10))
    capture(app)
    app.buttons["Close"].firstMatch.tap()
  }

  private func openManager(_ app: XCUIApplication) {
    let button = app.buttons["Manage vaults"].firstMatch
    XCTAssertTrue(button.waitForExistence(timeout: 60))
    button.tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 10))
  }

  private func localCommit(_ app: XCUIApplication) -> XCUIElement {
    app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Local commit:")).firstMatch
  }

  private func assertVisible(_ app: XCUIApplication, text: String) {
    let value = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    XCTAssertTrue(value.exists)
    XCTAssertTrue(app.frame.contains(value.frame), "Comparison must fit within the native app window: \(value.frame) vs \(app.frame)")
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func capture(_ app: XCUIApplication) {
    let geometry = XCTAttachment(string: "Native app bounds: \(app.frame)")
    geometry.lifetime = .keepAlways
    add(geometry)
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
