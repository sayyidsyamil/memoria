import XCTest

final class TabletCommandPaletteKeyboardTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testLandscapePaletteFitsAboveKeyboardAndNavigates() {
    verifyPalette(orientation: .landscapeLeft)
  }

  func testPortraitPaletteFitsAboveKeyboardAfterRotation() {
    verifyPalette(orientation: .portrait)
  }

  private func verifyPalette(orientation: UIDeviceOrientation) {
    XCUIDevice.shared.orientation = orientation
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&commandPalette=1&qaRun=palette-keyboard"]
    app.launch()
    let input = app.textFields.matching(identifier: "mobile-command-palette-input").firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 30))
    input.tap()
    input.typeText(" ")
    assertPaletteAboveKeyboard(app)
    assertResultsScrollWithoutExecuting(app)

    let other: UIDeviceOrientation = orientation == .portrait ? .landscapeLeft : .portrait
    XCUIDevice.shared.orientation = other
    waitUntil { (app.frame.width < app.frame.height) == (other == .portrait) }
    assertPaletteAboveKeyboard(app)
    input.typeText("All Notes")
    let command = app.buttons.matching(identifier: "mobile-command-palette-command-go-all-notes").firstMatch
    XCTAssertTrue(command.waitForExistence(timeout: 5))
    XCTAssertTrue(command.isHittable)
    command.tap()
    waitUntil { !self.element(app, "mobile-command-palette").exists }
    XCTAssertEqual(element(app, "note-list-toolbar-title").label, "All Notes")
  }

  private func assertPaletteAboveKeyboard(_ app: XCUIApplication) {
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(keyboard.frame.height, 200)
    let palette = element(app, "mobile-command-palette-panel")
    waitUntil { palette.frame.maxY <= keyboard.frame.minY + 1 }
    XCTAssertEqual(palette.frame.width, 540, accuracy: 1)
    XCTAssertTrue(app.frame.contains(palette.frame))
    XCTAssertTrue(app.textFields["mobile-command-palette-input"].isHittable)
    print("PALETTE_KEYBOARD_BOUNDS keyboard=\(keyboard.frame) palette=\(palette.frame)")
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func assertResultsScrollWithoutExecuting(_ app: XCUIApplication) {
    let palette = element(app, "mobile-command-palette-panel")
    let row = app.buttons.matching(identifier: "mobile-command-palette-command-go-all-notes").firstMatch
    let originalY = row.frame.minY
    let start = palette.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.78))
    let end = palette.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.3))
    start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
    XCTAssertTrue(palette.exists, "Scrolling must not execute a command")
    waitUntil { row.frame.minY < originalY - 60 }
    XCTAssertTrue(app.keyboards.firstMatch.exists)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }
}
