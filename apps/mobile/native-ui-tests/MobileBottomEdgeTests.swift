import XCTest

final class MobileBottomEdgeTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testPanelsAndFormattingSurfaceReachBottomEdge() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=list&editorMode=source&qaRun=bottom-edge"]
    app.launch()
    let row = element("note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    assertBottomEdge("note-list-panel")
    row.tap()
    XCTAssertTrue(element("editor-markdown-input").waitForExistence(timeout: 10))
    assertEditorEdge()
    XCUIDevice.shared.orientation = .landscapeLeft
    waitUntil { self.app.frame.width > self.app.frame.height }
    assertEditorEdge()
    attachScreen("bottom-edge-source-landscape")
    let mode = element("editor-source-action")
    XCTAssertTrue(mode.isHittable)
    mode.tap()
    XCTAssertTrue(element("editor-wysiwyg-input").waitForExistence(timeout: 10))
    assertEditorEdge()
    attachScreen("bottom-edge-rich-landscape")
    XCUIDevice.shared.orientation = .portrait
    waitUntil { self.app.frame.height > self.app.frame.width }
    assertEditorEdge()
    attachScreen("bottom-edge-rich-portrait")
  }

  func testFormattingToolbarMeetsSoftwareKeyboard() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=editor&editorMode=source&qaRun=bottom-edge-keyboard"]
    app.launch()
    let input = element("editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 30))
    input.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 8))
    attachScreen("bottom-edge-keyboard")
    XCTAssertEqual(element("editor-formatting-toolbar").frame.maxY, keyboardTop(keyboard), accuracy: 2)
    XCTAssertTrue(element("editor-format-bold").isHittable)
  }

  private func assertEditorEdge() {
    assertBottomEdge("editor-panel")
    assertBottomEdge("editor-formatting-toolbar")
    XCTAssertTrue(element("editor-format-bold").isHittable)
    XCTAssertFalse(element("sync-status-bar").exists)
  }

  private func keyboardTop(_ keyboard: XCUIElement) -> CGFloat {
    // XCTest excludes system prediction/assistant rows from the keyboard frame.
    let rows = [keyboard, app.buttons["assistantUndo"], app.otherElements["Typing Predictions"]]
    return rows.filter { $0.exists }.map { $0.frame.minY }.min() ?? keyboard.frame.minY
  }

  private func assertBottomEdge(_ identifier: String) {
    let panel = element(identifier)
    XCTAssertTrue(panel.waitForExistence(timeout: 5))
    XCTAssertEqual(panel.frame.maxY, app.frame.maxY, accuracy: 1,
      "\(identifier) must not leave a separate bottom band")
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ condition: @escaping () -> Bool) {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed)
  }

  private func attachScreen(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
