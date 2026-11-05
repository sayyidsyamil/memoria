import XCTest

final class TabletHardwareKeyboardTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testHardwareShortcutsAcrossWorkspaceAndEditors() {
    let app = launchFixture()
    verifyPaneShortcuts(app)
    verifyPaletteNavigation(app)
    verifyPaletteFromEditors(app)
  }

  private func verifyPaletteNavigation(_ app: XCUIApplication) {
    command(app, "k")
    let input = element(app, "mobile-command-palette-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    let result = element(app, "mobile-command-palette-command-go-all-notes")
    XCTAssertTrue(result.waitForExistence(timeout: 5))
    result.tap()
    waitUntil { self.element(app, "note-list-toolbar-title").label == "All Notes" }
    command(app, "k")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    closePalette(app)
  }

  private func verifyPaneShortcuts(_ app: XCUIApplication) {
    let editor = element(app, "editor-panel")
    let list = element(app, "note-list-panel")
    let sidebar = element(app, "workspace-sidebar-panel")
    command(app, "1")
    waitUntil { !list.exists && !sidebar.exists }
    XCTAssertEqual(editor.frame.minX, 0, accuracy: 1)
    command(app, "2")
    waitUntil { list.exists && !sidebar.exists }
    command(app, "3")
    waitUntil { list.exists && sidebar.exists }
    let properties = element(app, "properties-panel")
    let wasVisible = properties.exists
    command(app, "i", shift: true)
    waitUntil { properties.exists != wasVisible }
    command(app, "i", shift: true)
    waitUntil { properties.exists == wasVisible }
  }

  private func verifyPaletteFromEditors(_ app: XCUIApplication) {
    element(app, "editor-wysiwyg-input").tap()
    command(app, "k")
    let palette = element(app, "mobile-command-palette-input")
    XCTAssertTrue(palette.waitForExistence(timeout: 5))
    closePalette(app)
    waitUntil { !palette.exists }
    element(app, "editor-source-action").tap()
    let input = element(app, "editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    command(app, "k")
    XCTAssertTrue(palette.waitForExistence(timeout: 5))
    closePalette(app)
  }

  private func closePalette(_ app: XCUIApplication) {
    app.buttons["Cancel"].firstMatch.tap()
    waitUntil { !self.element(app, "mobile-command-palette-input").exists }
  }

  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&tabletPanels=all&qaRun=hardware-keys"]
    app.launchEnvironment["MEMORIA_MOBILE_KEYBOARD_SHORTCUT_PROBE"] = "1"
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar-title").waitForExistence(timeout: 30))
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func command(_ app: XCUIApplication, _ key: String, shift: Bool = false) {
    app.typeKey(key, modifierFlags: shift ? [.command, .shift] : .command)
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 8)
  }
}
