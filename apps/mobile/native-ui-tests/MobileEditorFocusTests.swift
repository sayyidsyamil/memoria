import XCTest

final class MobileEditorFocusTests: XCTestCase {
  func testNewNoteRetainsSoftwareKeyboardThroughAutosave() {
    verifyFocus(sourceName: "fixture")
  }

  func testLinkedFolderSyncDoesNotDismissNewNoteKeyboard() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_LINKED_FOCUS"] == "1", "Requires an isolated linked focus fixture")
    verifyFocus(sourceName: "native-vault")
  }

  private func verifyFocus(sourceName: String) {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=\(sourceName)&phoneState=list&editorMode=wysiwyg&qaRun=editor-focus"]
    app.launch()
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    editor.typeText("Focus before pause")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let lostKeyboard = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostKeyboard.isInverted = true
    wait(for: [lostKeyboard], timeout: 8)
    editor.typeText(" and after pause")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue((source.value as? String ?? "").contains("Focus before pause and after pause"))
    if sourceName == "native-vault" { flushOnDeparture(app) }
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func flushOnDeparture(_ app: XCUIApplication) {
    XCUIDevice.shared.press(.home)
    let background = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in [.runningBackground, .runningBackgroundSuspended].contains(app.state) }, object: nil)
    wait(for: [background], timeout: 5)
    let settled = expectation(description: "Allow the bounded background flush")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { settled.fulfill() }
    wait(for: [settled], timeout: 4)
    app.activate()
    XCTAssertTrue(element(app, "editor-markdown-input").waitForExistence(timeout: 5))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
