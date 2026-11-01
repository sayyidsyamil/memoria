import XCTest

final class MobileWideContentTests: XCTestCase {
  func testWideTableRemainsReachableWithoutNavigatingPanels() {
    let app = launchFixture()
    replaceSource(in: app, with: tableMarkdown)
    let editor = element(app, "editor-panel")
    let originalFrame = editor.frame
    let first = webText(app, "First column")
    let last = webText(app, "Last column")
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    XCTAssertTrue(last.waitForExistence(timeout: 5))
    capture("wide-table-before-scroll")
    let bounds = app.webViews.firstMatch.frame
    for _ in 0..<4 {
      if last.frame.maxX <= bounds.maxX { break }
      let origin = app.coordinate(withNormalizedOffset: .zero)
      let start = origin.withOffset(CGVector(dx: bounds.maxX - 64, dy: first.frame.midY))
      let end = origin.withOffset(CGVector(dx: bounds.minX + 64, dy: first.frame.midY))
      start.press(forDuration: 0.05, thenDragTo: end)
      XCTAssertTrue(editor.exists, "Dragging inside a table must not navigate away from the editor")
    }
    XCTAssertEqual(editor.frame.minX, originalFrame.minX, accuracy: 1)
    XCTAssertEqual(editor.frame.width, originalFrame.width, accuracy: 1)
    XCTAssertLessThanOrEqual(last.frame.maxX, bounds.maxX, "The final table column must be reachable")
    XCTAssertGreaterThanOrEqual(last.frame.minX, bounds.minX)
    XCTAssertTrue(last.isHittable)
    capture("wide-table-after-scroll")
  }

  func testLongLinkAndCodeRemainInsideTheEditor() {
    let app = launchFixture()
    let text = String(repeating: "abcdefghij", count: 12)
    replaceSource(in: app, with: "# Wide content\n\n[\(text)](https://example.com)\n\n```text\n\(text)\n```\n")
    let matches = app.webViews.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", text))
    XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 10))
    let bounds = app.webViews.firstMatch.frame
    for item in matches.allElementsBoundByIndex {
      XCTAssertGreaterThanOrEqual(item.frame.minX, bounds.minX)
      XCTAssertLessThanOrEqual(item.frame.maxX, bounds.maxX)
    }
    capture("long-link-and-code")
  }

  private var tableMarkdown: String {
    let headings = ["First column", "Second column", "Third column", "Fourth column", "Fifth column", "Last column"]
    return "# Wide content\n\n| " + headings.joined(separator: " | ") + " |\n| "
      + Array(repeating: "---", count: headings.count).joined(separator: " | ") + " |\n| "
      + Array(repeating: "Readable column content", count: headings.count).joined(separator: " | ") + " |\n"
  }

  private func launchFixture() -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=editor&editorMode=source&tabletPanels=all&qaRun=wide-content"]
    app.launch()
    XCTAssertTrue(element(app, "editor-markdown-input").waitForExistence(timeout: 30))
    return app
  }

  private func replaceSource(in app: XCUIApplication, with markdown: String) {
    let source = element(app, "editor-markdown-input")
    source.tap()
    app.typeKey("a", modifierFlags: .command)
    source.typeText(markdown)
    XCTAssertEqual(source.value as? String, markdown)
    element(app, "editor-source-action").tap()
    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
  }

  private func webText(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.webViews.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }
}
