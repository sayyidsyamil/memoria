import XCTest

final class MobilePendingCatalogTests: XCTestCase {
  func testInterruptedFirstSaveRestoresTheVaultAfterRelaunch() throws {
    try requireFixture("valid")
    let app = launchWorkspace()
    let row = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "note-row-")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    row.tap()
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    XCTAssertTrue((source.value as? String ?? "").contains("# Pending Catalog QA"))
    app.terminate()
    app.launch()
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    keepScreenshot(app)
  }

  func testCorruptPendingCatalogOffersRecoveryInsteadOfAnEmptyVault() throws {
    try requireFixture("corrupt")
    let app = launchWorkspace()
    let failure = element(app, "workspace-load-failure")
    XCTAssertTrue(failure.waitForExistence(timeout: 20))
    XCTAssertTrue(element(app, "vault-recovery-retry").isHittable)
    element(app, "vault-recovery-retry").tap()
    XCTAssertTrue(failure.waitForExistence(timeout: 10))
    XCTAssertFalse(element(app, "note-list-create-action").exists)
    keepScreenshot(app)
  }

  private func requireFixture(_ scenario: String) throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_PENDING_CATALOG"] == scenario,
      "Requires a disposable pending-catalog fixture")
    continueAfterFailure = false
  }

  private func launchWorkspace() -> XCUIApplication {
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&phoneState=list&qaRun=pending-catalog"]
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
