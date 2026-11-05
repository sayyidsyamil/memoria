import XCTest

final class MobileModalEscapeTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
  }

  func testEscapeCancelsFocusedWorkspaceFormWithoutSaving() {
    let app = launchFixture("&actionSheet=createView")
    let sheet = element(app, "workspace-action-sheet-createView")
    XCTAssertTrue(sheet.waitForExistence(timeout: 30))
    let field = element(app, "workspace-create-view-name-input")
    field.tap()
    field.typeText("Escape must not save")
    escape(app)
    XCTAssertTrue(sheet.waitForNonExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["Escape must not save"].exists)
    XCTAssertTrue(element(app, "workspace-sidebar-panel").exists)
  }

  func testEscapeClosesSettingsAndVaultManager() {
    let app = launchFixture()
    let openSettings = element(app, "open-mobile-settings")
    XCTAssertTrue(openSettings.waitForExistence(timeout: 30))
    openSettings.tap()
    let settings = element(app, "mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    escape(app)
    XCTAssertTrue(settings.waitForNonExistence(timeout: 5))
    openSettings.tap()
    let vaults = element(app, "settings-manage-vaults")
    XCTAssertTrue(vaults.waitForExistence(timeout: 5))
    if !vaults.isHittable { settings.swipeUp() }
    vaults.tap()
    let manager = element(app, "vault-manager")
    XCTAssertTrue(manager.waitForExistence(timeout: 5))
    escape(app)
    XCTAssertTrue(manager.waitForNonExistence(timeout: 5))
    XCTAssertFalse(settings.exists)
  }

  func testPaletteEscapeDoesNotChangeWorkspaceNavigation() {
    let app = launchFixture()
    let sidebar = element(app, "workspace-sidebar-panel")
    XCTAssertTrue(sidebar.waitForExistence(timeout: 30))
    let before = sidebar.frame
    app.typeKey("k", modifierFlags: .command)
    let palette = element(app, "mobile-command-palette-input")
    XCTAssertTrue(palette.waitForExistence(timeout: 5))
    escape(app)
    XCTAssertTrue(palette.waitForNonExistence(timeout: 5))
    escape(app)
    XCTAssertEqual(sidebar.frame, before)
  }

  private func launchFixture(_ extra: String = "") -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=sidebar&qaRun=modal-escape\(extra)"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launchEnvironment["MEMORIA_MOBILE_KEYBOARD_SHORTCUT_PROBE"] = "1"
    app.launch()
    return app
  }

  private func escape(_ app: XCUIApplication) {
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
