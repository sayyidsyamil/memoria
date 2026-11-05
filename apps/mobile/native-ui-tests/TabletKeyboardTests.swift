import XCTest

final class TabletKeyboardTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testLongFormKeepsFooterAboveLandscapeKeyboard() {
    verifyLongForm(orientation: .landscapeLeft)
  }

  func testLongFormKeepsFooterAbovePortraitKeyboard() {
    verifyLongForm(orientation: .portrait)
  }

  func testShortFormKeepsFooterReachableAfterRotation() {
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = launchFixture()
    let createFolder = element(app, "sidebar-section-create-folders")
    XCTAssertTrue(createFolder.waitForExistence(timeout: 30))
    createFolder.tap()
    let field = app.textFields.matching(identifier: "workspace-create-folder-name-input").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("Keyboard folder")
    assertFooterAboveKeyboard(app)
    XCUIDevice.shared.orientation = .portrait
    waitUntil { app.frame.width < app.frame.height }
    assertFooterAboveKeyboard(app)
    app.buttons.matching(identifier: "Cancel").firstMatch.tap()
    waitUntil { !self.element(app, "workspace-action-sheet").exists }
  }

  func testEditorFormattingStaysAboveSoftwareKeyboard() {
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = launchFixture()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 30))
    editor.tap()
    editor.typeText(" Native keyboard QA")
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(keyboard.frame.height, 200)
    assertFormattingAboveKeyboard(app)
    XCUIDevice.shared.orientation = .portrait
    waitUntil { app.frame.width < app.frame.height }
    assertFormattingAboveKeyboard(app)
    let heading = element(app, "editor-format-heading-2")
    if !heading.isHittable { element(app, "editor-formatting-toolbar").swipeLeft() }
    XCTAssertTrue(heading.waitForExistence(timeout: 5))
    XCTAssertTrue(heading.isHittable)
    XCTAssertLessThanOrEqual(heading.frame.maxY, keyboard.frame.minY + 1)
    heading.tap()
    XCTAssertTrue(element(app, "editor-formatting-toolbar").exists)
  }

  func testOpeningFormDismissesBackgroundEditorKeyboard() {
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = launchFixture()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 30))
    editor.tap()
    editor.typeText(" Keyboard transition")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(app.keyboards.firstMatch.frame.height, 200)
    element(app, "sidebar-section-create-views").tap()
    let field = app.textFields.matching(identifier: "workspace-create-view-name-input").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    waitUntil { !app.keyboards.firstMatch.exists }
    field.tap()
    field.typeText("Keyboard transition view")
    assertFooterAboveKeyboard(app)
    app.buttons.matching(identifier: "Cancel").firstMatch.tap()
    waitUntil { !self.element(app, "workspace-action-sheet").exists }
  }

  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&qaRun=keyboard-regression"]
    app.launch()
    return app
  }

  private func assertFormattingAboveKeyboard(_ app: XCUIApplication) {
    let headingMenu = element(app, "editor-format-bold")
    let keyboard = app.keyboards.firstMatch
    waitUntil { headingMenu.frame.maxY <= keyboard.frame.minY + 1 }
    XCTAssertTrue(headingMenu.isHittable)
    XCTAssertEqual(headingMenu.frame.height, 44, accuracy: 1)
    print("TOOLBAR_KEYBOARD_BOUNDS keyboard=\(keyboard.frame) formatting=\(headingMenu.frame)")
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func verifyLongForm(orientation: UIDeviceOrientation) {
    XCUIDevice.shared.orientation = orientation
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&actionSheet=createView&qaRun=keyboard-regression"]
    app.launch()
    let field = app.textFields.matching(identifier: "workspace-create-view-name-input").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 30))
    let sheet = element(app, "workspace-action-sheet-createView")
    XCTAssertEqual(sheet.frame.width, 640, accuracy: 1)
    XCTAssertEqual(field.frame.minX - sheet.frame.minX, 17.6, accuracy: 1)
    field.tap()
    field.typeText("Keyboard regression")
    assertFooterAboveKeyboard(app)
    let other: UIDeviceOrientation = orientation == .portrait ? .landscapeLeft : .portrait
    XCUIDevice.shared.orientation = other
    waitUntil { (app.frame.width < app.frame.height) == (other == .portrait) }
    assertFooterAboveKeyboard(app)
    let cancel = app.buttons.matching(identifier: "Cancel").firstMatch
    XCTAssertTrue(cancel.isHittable)
    cancel.tap()
    waitUntil { !sheet.exists && !app.keyboards.firstMatch.exists }
    XCTAssertTrue(element(app, "editor-panel").exists)
  }

  private func assertFooterAboveKeyboard(_ app: XCUIApplication) {
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "A software keyboard is required")
    XCTAssertGreaterThan(keyboard.frame.height, 200, "An accessory bar is not a software keyboard")
    let create = app.buttons.matching(identifier: "Create").firstMatch
    XCTAssertTrue(create.exists)
    // Wait for the native keyboard animation, then compare real screen coordinates.
    waitUntil { create.frame.maxY <= keyboard.frame.minY + 1 }
    XCTAssertTrue(create.isHittable)
    print("KEYBOARD_BOUNDS keyboard=\(keyboard.frame) create=\(create.frame)")
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }
}
