import XCTest

final class MobileCreateNoteButtonTests: XCTestCase {
  func testBottomCreateActionOpensFocusedEditor() {
    verifyCreation(.portrait)
  }

  func testLandscapeBottomCreateActionOpensFocusedEditor() {
    verifyCreation(.landscapeLeft)
  }

  func testBulkSelectionReplacesCreateAction() {
    let app = launchWorkspace(.portrait)
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    let note = fixtureNote(app)
    XCTAssertTrue(note.waitForExistence(timeout: 5))
    note.press(forDuration: 0.8)
    XCTAssertTrue(element(app, "note-list-bulk-action-bar").waitForExistence(timeout: 5))
    XCTAssertFalse(create.exists)
    element(app, "note-list-bulk-clear").tap()
    XCTAssertTrue(create.waitForExistence(timeout: 5))
  }

  private func launchWorkspace(_ orientation: UIDeviceOrientation) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = orientation
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=list&qaRun=create-button"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(fixtureNote(app).waitForExistence(timeout: 30))
    return app
  }

  private func fixtureNote(_ app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "note-row-")).firstMatch
  }

  private func verifyCreation(_ orientation: UIDeviceOrientation) {
    let app = launchWorkspace(orientation)
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    let panel = element(app, "note-list-panel")
    let toolbar = element(app, "note-list-toolbar")
    XCTAssertEqual(toolbar.descendants(matching: .any).matching(identifier: "note-list-create-action").count, 0)
    XCTAssertGreaterThanOrEqual(create.frame.width, 56)
    XCTAssertEqual(create.frame.width, create.frame.height, accuracy: 1)
    XCTAssertGreaterThan(create.frame.minY, panel.frame.midY)
    XCTAssertGreaterThan(create.frame.minX, panel.frame.minX)
    XCTAssertLessThan(create.frame.maxX, panel.frame.maxX)
    XCTAssertLessThan(create.frame.maxY, panel.frame.maxY)
    let filters = element(app, "note-list-filter-pills")
    if filters.exists { XCTAssertLessThan(create.frame.maxY, filters.frame.minY) }
    keepScreenshot(app)
    create.tap()
    XCTAssertFalse(element(app, "workspace-action-sheet").exists)
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.typeText("Created with the bottom button")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue((source.value as? String ?? "").contains("# Created with the bottom button"))
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
