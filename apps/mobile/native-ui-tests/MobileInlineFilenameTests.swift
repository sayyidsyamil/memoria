import XCTest

final class MobileInlineFilenameTests: XCTestCase {
  func testInlineRenamePreservesNoteContent() {
    let app = launchWorkspace()
    let input = beginRename(app)
    replace(input, with: "native-inline-rename.md")
    element(app, "editor-filename-save").tap()
    let title = element(app, "editor-toolbar-title")
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.label, "native-inline-rename.md")
    XCTAssertFalse(element(app, "workspace-action-sheet").exists)
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue((source.value as? String ?? "").contains("Workflow Orchestration Essay"))
    keepScreenshot()
  }

  func testInvalidRenameAndCancellationPreserveFilename() {
    let app = launchWorkspace()
    let input = beginRename(app)
    replace(input, with: "../outside.md")
    XCTAssertFalse(element(app, "editor-filename-save").isEnabled)
    replace(input, with: "How I Run an Open Source Project.md")
    XCTAssertFalse(element(app, "editor-filename-save").isEnabled)
    element(app, "editor-filename-cancel").tap()
    XCTAssertEqual(element(app, "editor-toolbar-title").label, "Workflow Orchestration Essay.md")
    XCTAssertFalse(input.exists)
  }

  private func launchWorkspace() -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=editor&editorMode=source&qaRun=inline-filename"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar-title").waitForExistence(timeout: 30))
    let title = element(app, "editor-toolbar-title").frame
    let action = element(app, "editor-filename-action").frame
    XCTAssertEqual(title.midY, action.midY, accuracy: 2)
    XCTAssertGreaterThanOrEqual(action.height, 44)
    return app
  }

  private func beginRename(_ app: XCUIApplication) -> XCUIElement {
    element(app, "editor-filename-action").tap()
    let input = element(app, "editor-filename-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    XCTAssertEqual(input.value as? String, "Workflow Orchestration Essay.md")
    XCTAssertEqual(input.frame.midY, element(app, "editor-filename-save").frame.midY, accuracy: 2)
    XCTAssertEqual(input.frame.midY, element(app, "editor-filename-cancel").frame.midY, accuracy: 2)
    XCTAssertGreaterThanOrEqual(element(app, "editor-filename-save").frame.height, 44)
    keepScreenshot()
    return input
  }

  private func replace(_ input: XCUIElement, with value: String) {
    let previous = input.value as? String ?? ""
    input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count) + value)
  }

  private func keepScreenshot() {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
