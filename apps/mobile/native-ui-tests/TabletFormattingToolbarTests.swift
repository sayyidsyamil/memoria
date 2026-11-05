import XCTest

final class TabletFormattingToolbarTests: XCTestCase {
  func testTabletFormattingStripKeepsTouchTargetsAndAppliesHeading() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&tabletPanels=all&qaRun=toolbar"]
    app.launch()
    let toolbar = element(app, "editor-formatting-toolbar")
    XCTAssertTrue(toolbar.waitForExistence(timeout: 60))
    let heading = element(app, "editor-format-heading-2")
    XCTAssertTrue(heading.waitForExistence(timeout: 5))
    reveal(heading, in: toolbar)
    XCTAssertTrue(heading.isHittable)
    XCTAssertEqual(heading.frame.height, 44, accuracy: 1)
    XCTAssertEqual(heading.frame.width, 44, accuracy: 1)
    XCTAssertTrue(app.frame.contains(heading.frame))
    heading.tap()
    waitUntil { heading.isSelected }
    heading.tap()
    waitUntil { !heading.isSelected }
    let quote = element(app, "editor-format-quote")
    reveal(quote, in: toolbar)
    XCTAssertTrue(quote.isHittable)
    let math = element(app, "editor-format-math-block")
    reveal(math, in: toolbar)
    XCTAssertTrue(math.isHittable)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
    MobilePanelNavigation.toggleProperties(app)
    waitUntil { !self.element(app, "properties-panel").exists }
  }

  private func reveal(_ target: XCUIElement, in toolbar: XCUIElement) {
    for _ in 0..<12 {
      if target.isHittable { return }
      let movingLeft = target.frame.midX > toolbar.frame.midX
      let startX = movingLeft ? 0.7 : 0.3
      let endX = movingLeft ? 0.4 : 0.6
      toolbar.coordinate(withNormalizedOffset: CGVector(dx: startX, dy: 0.5))
        .press(forDuration: 0.05, thenDragTo: toolbar.coordinate(withNormalizedOffset: CGVector(dx: endX, dy: 0.5)))
    }
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }
}
