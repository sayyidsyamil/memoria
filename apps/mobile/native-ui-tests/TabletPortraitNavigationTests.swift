import XCTest

final class TabletPortraitNavigationTests: XCTestCase {
  func testSidebarNavigationPreservesEditorAndReturnsToFullList() throws {
    let app = launchPortrait()
    defer { app.terminate(); XCUIDevice.shared.orientation = .landscapeLeft }
    MobilePanelNavigation.openSidebar(app)
    assertSidebarDrawer(app)
    app.buttons.matching(identifier: "sidebar-item-all-notes").firstMatch.tap()
    waitUntil { !self.element(app, "workspace-sidebar-panel").exists }
    XCTAssertEqual(element(app, "note-list-panel").frame.minX, 0, accuracy: 1)
    XCTAssertEqual(element(app, "note-list-panel").frame.width, 340, accuracy: 1)
    XCTAssertEqual(app.staticTexts.matching(identifier: "note-list-toolbar-title").firstMatch.label, "All Notes")
    XCTAssertTrue(element(app, "note-row-workflow-orchestration").waitForExistence(timeout: 5))
    MobilePanelNavigation.openSidebar(app)
    assertSidebarDrawer(app)
    drag(element(app, "workspace-sidebar-panel"), dx: -240)
    waitUntil { !self.element(app, "workspace-sidebar-panel").exists }
    MobilePanelNavigation.toggleProperties(app)
    waitUntil { self.element(app, "properties-panel").exists }
    XCTAssertGreaterThanOrEqual(element(app, "editor-panel").frame.width, 520)
  }

  func testDragSidebarUsesSamePortraitGeometry() throws {
    let app = launchPortrait()
    defer { app.terminate(); XCUIDevice.shared.orientation = .landscapeLeft }
    drag(element(app, "note-list-toolbar"), dx: 240)
    assertSidebarDrawer(app)
    drag(element(app, "workspace-sidebar-panel"), dx: -240)
    waitUntil { !self.element(app, "workspace-sidebar-panel").exists }
    XCTAssertEqual(element(app, "editor-panel").frame.minX, 340, accuracy: 1)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func launchPortrait() -> XCUIApplication {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    let search = "?source=fixture&editorMode=wysiwyg&qaRun=portrait-navigation"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element(app, "note-list-panel").waitForExistence(timeout: 60))
    XCTAssertTrue(element(app, "note-row-workflow-orchestration").waitForExistence(timeout: 10))
    waitUntil { app.frame.width < app.frame.height }
    return app
  }

  private func assertSidebarDrawer(_ app: XCUIApplication) {
    let sidebar = element(app, "workspace-sidebar-panel")
    waitUntil { sidebar.exists && abs(sidebar.frame.minX) < 1 }
    XCTAssertEqual(sidebar.frame.width, 260, accuracy: 1)
    let editor = element(app, "editor-panel")
    XCTAssertGreaterThanOrEqual(editor.frame.width, 520)
    XCTAssertEqual(editor.frame.minX, 340, accuracy: 1)
    XCTAssertEqual(editor.frame.maxX, app.frame.width, accuracy: 1)
    XCTAssertTrue(app.buttons.matching(identifier: "sidebar-item-all-notes").firstMatch.isHittable)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }

  private func drag(_ element: XCUIElement, dx: Double) {
    let startX = dx < 0 ? 0.95 : 0.3
    let start = element.coordinate(withNormalizedOffset: CGVector(dx: startX, dy: 0.6))
    start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: dx, dy: 0)), withVelocity: XCUIGestureVelocity(rawValue: 250), thenHoldForDuration: 0)
  }
}
