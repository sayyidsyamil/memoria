import XCTest

final class MobileVaultRecoveryTests: XCTestCase {
  func testBackgroundConflictNotifiesWithoutOpeningAModal() throws {
    try requireFixture("conflict")
    let app = launchWorkspace()
    let notice = element(app, "vault-sync-notice")
    XCTAssertTrue(notice.waitForExistence(timeout: 25))
    XCTAssertFalse(element(app, "vault-manager").exists)
    XCTAssertTrue(element(app, "note-list-create-action").exists)
    keepScreenshot(app)
    element(app, "vault-notice-manage").tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
    XCTAssertTrue(element(app, "review-sync-conflicts").exists)
    app.buttons["Close"].firstMatch.tap()
    element(app, "note-list-create-action").tap()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    editor.typeText("Editing remains available after a conflict")
    XCTAssertTrue(app.keyboards.firstMatch.exists)
    let lostKeyboard = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostKeyboard.isInverted = true
    wait(for: [lostKeyboard], timeout: 8)
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue((source.value as? String ?? "").contains("Editing remains available after a conflict"))
  }

  func testUnreadableCatalogOffersRecoveryWithoutReplacingTheVault() throws {
    try requireFixture("catalog")
    let app = launchWorkspace()
    let failure = element(app, "workspace-load-failure")
    XCTAssertTrue(failure.waitForExistence(timeout: 15))
    XCTAssertFalse(element(app, "vault-manager").exists)
    XCTAssertTrue(element(app, "vault-recovery-retry").isHittable)
    element(app, "vault-recovery-retry").tap()
    XCTAssertTrue(failure.waitForExistence(timeout: 10))
    XCTAssertFalse(element(app, "note-list-create-action").exists)
    keepScreenshot(app)
  }

  private func requireFixture(_ value: String) throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_RECOVERY"] == value,
      "Requires a disposable native recovery fixture")
    continueAfterFailure = false
  }

  private func launchWorkspace() -> XCUIApplication {
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&phoneState=list&qaRun=vault-recovery"]
    app.launch()
    return app
  }

  private func keepScreenshot(_ app: XCUIApplication) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
