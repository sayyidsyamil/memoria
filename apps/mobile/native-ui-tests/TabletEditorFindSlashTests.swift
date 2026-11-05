import XCTest

final class TabletEditorFindSlashTests: XCTestCase {
  func testInlineFindNavigationReplacementAndLayout() {
    continueAfterFailure = false
    let app = launchFixture("editor")
    openFind(app)
    let field = element(app, "workspace-find-input")
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "workspace-action-sheet-findInNote").exists)
    field.tap()
    field.typeText("mobile")
    let count = element(app, "workspace-find-count")
    waitUntil { count.label.hasPrefix("1 /") }
    element(app, "workspace-find-next").tap()
    waitUntil { count.label.hasPrefix("2 /") }
    XCTAssertTrue(field.isHittable)
    XCTAssertGreaterThanOrEqual(element(app, "workspace-find-next").frame.height, 44)
    XCTAssertGreaterThanOrEqual(element(app, "editor-inline-find").frame.minY, element(app, "editor-more-action").frame.maxY)
    element(app, "workspace-find-show-replace").tap()
    let replacement = element(app, "workspace-replace-input")
    replacement.tap()
    replacement.typeText("tablet")
    element(app, "workspace-replace-all").tap()
    waitUntil { count.label == "No matches" }
    capture()
    element(app, "workspace-find-close").tap()
    XCTAssertFalse(element(app, "editor-inline-find").exists)
    XCTAssertTrue(app.webViews.textViews.firstMatch.exists)
  }

  func testSlashCommandTouchSelection() {
    continueAfterFailure = false
    let app = launchFixture("list")
    element(app, "note-list-create-action").tap()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    editor.typeText("/heading 2")
    let command = element(app, "editor-slash-heading2")
    XCTAssertTrue(command.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(command.frame.height, 44)
    capture()
    command.tap()
    waitUntil { !self.element(app, "editor-slash-menu").exists }
    editor.typeText("Slash heading")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue((source.value as? String ?? "").contains("## Slash heading"))
    XCTAssertFalse((source.value as? String ?? "").contains("/heading"))
  }

  private func launchFixture(_ phoneState: String) -> XCUIApplication {
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=\(phoneState)&editorMode=wysiwyg&qaRun=find-slash"]
    app.launch()
    let ready = phoneState == "list" ? "note-list-create-action" : "editor-more-action"
    XCTAssertTrue(element(app, ready).waitForExistence(timeout: 60))
    return app
  }

  private func openFind(_ app: XCUIApplication) {
    element(app, "editor-more-action").tap()
    element(app, "workspace-action-group-edit").tap()
    element(app, "workspace-action-find-in-note").tap()
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }

  private func capture() {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
