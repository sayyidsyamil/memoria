import XCTest

// The host seeds this disposable, organized note in the simulator vault only.
final class TabletPreparedNoteActionTests: XCTestCase {
  func testUnopenedNoteDeleteUndoSurvivesRestart() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&editorMode=wysiwyg"]
    app.launch()
    let allNotes = app.buttons.matching(identifier: "sidebar-item-all-notes").firstMatch
    XCTAssertTrue(allNotes.waitForExistence(timeout: 60))
    allNotes.tap()
    XCTAssertNotEqual(element(app, "editor-toolbar-title").label, "codex-prepared-action-qa.md")
    let row = element(app, "note-row-codex-prepared-action-qa.md")
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.press(forDuration: 0.7)
    app.buttons.matching(identifier: "note-list-bulk-delete").firstMatch.tap()
    waitUntil { !row.exists }
    app.buttons.matching(identifier: "editor-more-action").firstMatch.tap()
    element(app, "workspace-action-group-edit").tap()
    let undo = app.buttons.matching(identifier: "workspace-action-undo-edit").firstMatch
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    undo.tap()
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    assertBody(app)
    XCUIDevice.shared.press(.home)
    app.terminate()
    app.launch()
    XCTAssertTrue(allNotes.waitForExistence(timeout: 60))
    allNotes.tap()
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    assertBody(app)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func assertBody(_ app: XCUIApplication) {
    let body = app.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Original full body for native Undo.")).firstMatch
    XCTAssertTrue(body.waitForExistence(timeout: 15))
    XCTAssertFalse(element(app, "note-read-error").exists)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }
}
