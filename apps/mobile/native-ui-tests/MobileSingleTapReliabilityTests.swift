import XCTest

final class MobileSingleTapReliabilityTests: XCTestCase {
  func testColdLaunchCommandsAndEditorModeRespondToEverySingleTap() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_FRESH_STARTER"] == "1",
      "Requires a disposable fresh installation")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&commandPalette=1&qaRun=single-tap-reliability"]

    for _ in 0..<4 {
      app.terminate()
      app.launch()
      let command = element(app, "mobile-command-palette-command-go-all-notes")
      XCTAssertTrue(command.waitForExistence(timeout: 30))
      command.tap()
      expect(element(app, "mobile-command-palette"), "exists == false")
      expect(element(app, "note-list-toolbar-title"), "label == 'All Notes'")
      let guide = element(app, "note-row-get-familiar-with-memoria.md")
      reveal(guide, in: app)
      guide.tap()
      expect(element(app, "editor-toolbar-title"), "label == 'get-familiar-with-memoria.md'")
      let stage = element(app, "phone-transition-stage")
      if stage.exists {
        let editor = element(app, "editor-panel")
        MobilePanelNavigation.wait { abs(editor.frame.minX - stage.frame.minX) < 1 }
      }
      let toggle = element(app, "editor-source-action")
      toggle.tap()
      let source = element(app, "editor-markdown-input")
      XCTAssertTrue(source.waitForExistence(timeout: 10))
      XCTAssertTrue((source.value as? String ?? "").contains("# Get familiar with Memoria"))
      toggle.tap()
      expect(source, "exists == false")
      XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
    }
    app.terminate()
  }

  private func reveal(_ row: XCUIElement, in app: XCUIApplication) {
    let list = element(app, "note-list-panel")
    for _ in 0..<12 {
      if row.exists && row.isHittable { return }
      list.swipeUp()
    }
    XCTAssertTrue(row.isHittable)
  }

  private func expect(_ target: XCUIElement, _ predicate: String) {
    expectation(for: NSPredicate(format: predicate), evaluatedWith: target)
    waitForExpectations(timeout: 10)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
