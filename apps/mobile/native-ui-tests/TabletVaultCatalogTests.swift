import XCTest

// The host runner seeds only disposable local-qa-alpha/beta copies and restores
// the previous catalog afterwards; this test never edits an existing user note.
final class TabletVaultCatalogTests: XCTestCase {
  func testSwitchRestoreAndForgetWithoutDeletingVaults() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_VAULT_CATALOG"] == "1", "Requires disposable host-prepared catalog entries")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native&qaRun=vault-catalog"]
    app.launch()
    openManager(app)
    select(app, id: "local-qa-alpha", title: "Catalog QA Alpha")
    openManager(app)
    select(app, id: "local-qa-beta", title: "Catalog QA Beta")
    app.terminate()
    app.launch()
    XCTAssertTrue(note(app, "Catalog QA Beta").waitForExistence(timeout: 30))
    openManager(app)
    element(app, "forget-vault-local-qa-beta").tap()
    XCTAssertTrue(element(app, "forget-vault-confirmation").waitForExistence(timeout: 5))
    element(app, "confirm-forget-vault").tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element(app, "select-vault-local-qa-beta"))
    waitForExpectations(timeout: 5)
    XCTAssertTrue(element(app, "select-vault-local-qa-alpha").exists)
    select(app, id: "local-qa-alpha", title: "Catalog QA Alpha")
  }

  private func openManager(_ app: XCUIApplication) {
    let open = element(app, "open-mobile-settings")
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let manage = element(app, "settings-manage-vaults")
    if !manage.isHittable { element(app, "mobile-settings").swipeUp() }
    manage.tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
  }

  private func select(_ app: XCUIApplication, id: String, title: String) {
    let row = element(app, "select-vault-" + id)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    row.tap()
    let close = app.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 10))
    close.tap()
    XCTAssertTrue(note(app, title).waitForExistence(timeout: 15))
  }

  private func note(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
