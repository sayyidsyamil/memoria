import XCTest

final class MobileSourceFocusTests: XCTestCase {
  func testCreatedSourceNoteFocusesBodyAndDoesNotRefocusAfterChangingMode() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=list&editorMode=source&qaRun=source-focus"]
    app.launch()
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    app.typeText("Raw title\nBody typed without an editor tap.")
    assertKeyboardStays(app, visible: true, seconds: 5)
    app.typeText(" Still focused.")
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("# Raw title"))
    XCTAssertTrue(content.contains("type: Note"))
    XCTAssertTrue(content.contains("Body typed without an editor tap. Still focused."))
    attachScreenshot()
    element(app, "editor-source-action").tap()
    XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    assertKeyboardStays(app, visible: false, seconds: 3)
  }

  private func assertKeyboardStays(_ app: XCUIApplication, visible: Bool, seconds: TimeInterval) {
    let changed = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in app.keyboards.firstMatch.exists != visible }, object: nil)
    changed.isInverted = true
    wait(for: [changed], timeout: seconds)
  }

  private func attachScreenshot() {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
