import XCTest

final class TabletSourceScrollTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testSourceFormattingStaysAboveKeyboardAfterRotation() {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=source&qaRun=source-keyboard"]
    app.launch()
    let input = app.textViews.matching(identifier: "editor-markdown-input").firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 30))
    input.tap()
    input.typeText("Source keyboard")
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    let formatting = app.buttons.matching(identifier: "editor-format-bold").firstMatch
    waitUntil { formatting.frame.maxY <= keyboard.frame.minY + 1 }
    XCTAssertTrue(formatting.isHittable)
    XCUIDevice.shared.orientation = .portrait
    waitUntil { app.frame.width < app.frame.height }
    waitUntil { formatting.frame.maxY <= keyboard.frame.minY + 1 }
    XCTAssertTrue(formatting.isHittable)
    formatting.tap()
    XCTAssertTrue((input.value as? String)?.contains("**") == true)
  }

  func testSourceInputFillsEditorAndSyntaxFollowsNativeScrolling() {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=source&qaRun=source-scroll"]
    app.launch()
    let input = app.textViews.matching(identifier: "editor-markdown-input").firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 30))
    print("SOURCE_INPUT_BOUNDS \(input.frame)")
    XCTAssertGreaterThan(input.frame.height, 300, "The actual input must fill the editor, not only its color overlay")
    let syntax = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "# Workflow Orchestration Essay")).firstMatch
    XCTAssertTrue(syntax.exists)
    let initialY = syntax.frame.minY
    input.tap()
    input.typeText((1...50).map { "\nScroll line \($0)" }.joined())
    XCTAssertGreaterThan(syntax.frame.height, input.frame.height + 1000, "The syntax layer must lay out the whole document, not clip at the viewport height")
    waitUntil { syntax.frame.minY < initialY - 200 }
    let typedScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    typedScreenshot.name = "source-after-typing-fifty-lines"
    typedScreenshot.lifetime = .keepAlways
    add(typedScreenshot)
    let scrolledY = syntax.frame.minY
    input.swipeDown()
    waitUntil { syntax.frame.minY > scrolledY + 50 }
    XCTAssertTrue((input.value as? String)?.contains("Scroll line 50") == true)
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }
}
