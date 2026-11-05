import XCTest

final class MobileCreatedNoteFocusTests: XCTestCase {
  func testExistingNoteDoesNotTakeKeyboardFocus() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=list&qaRun=existing-focus"]
    app.launch()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    row.tap()
    XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 10))
    let keyboardAppeared = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in app.keyboards.firstMatch.exists }, object: nil)
    keyboardAppeared.isInverted = true
    wait(for: [keyboardAppeared], timeout: 3)
  }

  func testCreateFocusesEmptyHeadingWithoutAnEditorTap() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=list&qaRun=create-focus"]
    app.launch()
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    let began = ProcessInfo.processInfo.systemUptime
    create.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    let elapsed = Int((ProcessInfo.processInfo.systemUptime - began) * 1000)
    let timing = XCTAttachment(string: "{\"createToKeyboardMs\":\(elapsed)}")
    timing.name = "create-to-keyboard"
    timing.lifetime = .keepAlways
    add(timing)
    app.typeText("New title\nBody written without tapping the editor.")
    let lostKeyboard = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostKeyboard.isInverted = true
    wait(for: [lostKeyboard], timeout: 5)
    app.typeText(" Still focused.")
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("# New title"))
    XCTAssertTrue(content.contains("Body written without tapping the editor."))
    XCTAssertTrue(content.contains("Still focused."))
    XCTAssertTrue(content.contains("type: Note"))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
