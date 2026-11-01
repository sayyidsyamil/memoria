import XCTest

final class TabletAccountSettingsTests: XCTestCase {
  func testSettingsIncludesGitHubAndVaultManagement() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=account-settings"]
    app.launch()
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let sheet = element(app, "mobile-settings")
    XCTAssertTrue(sheet.waitForExistence(timeout: 5))
    sheet.swipeUp()
    XCTAssertTrue(app.staticTexts["GitHub"].exists)
    let vaults = element(app, "settings-manage-vaults")
    XCTAssertTrue(vaults.isHittable)
    vaults.tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
    XCTAssertFalse(sheet.exists)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
