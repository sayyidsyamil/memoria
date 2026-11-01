import XCTest

final class PhonePanelTransitionTests: XCTestCase {
  func testRepeatedPanelDragsSettleAtTheDestination() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=list&editorMode=wysiwyg&qaRun=phone-panel-settle"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    let list = element(app, "phone-note-list-screen")
    XCTAssertTrue(list.waitForExistence(timeout: 30))
    for _ in 0..<2 {
      drag(list, from: 0.3, to: 0.9, y: 0.025)
      assertSettled(element(app, "phone-sidebar-screen"), in: app)
      drag(element(app, "phone-sidebar-screen"), from: 0.7, to: 0.1)
      assertSettled(list, in: app)
    }
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Workflow Orchestration Essay")).firstMatch.tap()
    let editor = element(app, "phone-editor-screen")
    assertSettled(editor, in: app)
    assertEditorContentAligned(in: app)
    drag(editor, from: 0.99, to: 0.1)
    let properties = element(app, "phone-properties-screen")
    assertSettled(properties, in: app)
    drag(properties, from: 0.1, to: 0.9)
    assertSettled(editor, in: app)
    assertEditorContentAligned(in: app)
    drag(editor, from: 0.01, to: 0.85)
    assertSettled(list, in: app)
  }

  private func assertSettled(_ panel: XCUIElement, in app: XCUIApplication) {
    XCTAssertTrue(panel.waitForExistence(timeout: 5))
    let bounds = app.frame
    let settled = NSPredicate { _, _ in
      abs(panel.frame.minX - bounds.minX) < 1 && abs(panel.frame.width - bounds.width) < 1
    }
    let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 5)
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = panel.identifier
    screenshot.lifetime = .keepAlways
    add(screenshot)
    XCTAssertEqual(result, .completed, "Panel \(panel.identifier): \(panel.frame); app: \(bounds)")
    XCTAssertEqual(panel.frame.minX, bounds.minX, accuracy: 1)
  }

  private func assertEditorContentAligned(in app: XCUIApplication) {
    let heading = app.webViews.descendants(matching: .any)
      .matching(identifier: "Workflow Orchestration Essay").firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 5))
    let aligned = NSPredicate { _, _ in
      heading.frame.minX >= app.frame.minX + 20 && heading.frame.maxX <= app.frame.maxX - 20
    }
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: aligned, object: nil)], timeout: 3), .completed,
      "Heading: \(heading.frame); WebView: \(app.webViews.firstMatch.frame); app: \(app.frame)")
  }

  private func drag(_ panel: XCUIElement, from: Double, to: Double, y: Double = 0.4) {
    let start = panel.coordinate(withNormalizedOffset: CGVector(dx: from, dy: y))
    let end = panel.coordinate(withNormalizedOffset: CGVector(dx: to, dy: y))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
