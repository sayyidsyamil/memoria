import XCTest

final class PhoneNoteCreationTests: XCTestCase {
  func testCreateOpensUntitledNoteWithoutTitleDialog() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=list&editorMode=source&qaRun=phone-create"]
    app.launch()
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    XCTAssertTrue(element(app, "phone-editor-screen").waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "workspace-action-sheet").exists)
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.exists)
    source.tap()
    source.typeText("A body without a title.")
    MobilePanelNavigation.back(app)
    XCTAssertTrue(element(app, "phone-note-list-screen").waitForExistence(timeout: 5))
    let note = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "A body without a title.")).firstMatch
    XCTAssertTrue(note.waitForExistence(timeout: 5))
    note.tap()
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("A body without a title."))
    XCTAssertTrue(content.contains("type: Note"))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
