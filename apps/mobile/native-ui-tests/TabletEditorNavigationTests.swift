import XCTest

final class TabletEditorNavigationTests: XCTestCase {
  func testEditorInteriorDragsHideAndRestorePanels() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&tabletPanels=all&qaRun=editor-panel-drag"]
    app.launch()
    let editor = element(app, "editor-panel")
    XCTAssertTrue(editor.waitForExistence(timeout: 30))
    MobilePanelNavigation.toggleProperties(app)
    waitUntil { !self.element(app, "properties-panel").exists }
    XCTAssertEqual(editor.frame.minX, 600, accuracy: 1)
    dragEditor(editor, dx: -220)
    waitUntil { abs(editor.frame.minX - 340) < 1 }
    dragEditor(editor, dx: -320)
    waitUntil { abs(editor.frame.minX) < 1 }
    dragEditor(editor, dx: 300)
    waitUntil { abs(editor.frame.minX - 340) < 1 }
    dragEditor(editor, dx: 240)
    waitUntil { abs(editor.frame.minX - 600) < 1 }
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func dragEditor(_ editor: XCUIElement, dx: Double) {
    let start = editor.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.6))
    start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: dx, dy: 0)),
                withVelocity: XCUIGestureVelocity(rawValue: 250), thenHoldForDuration: 0)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func waitUntil(_ condition: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in condition() }, evaluatedWith: nil)
    waitForExpectations(timeout: 8)
  }
}
