import XCTest

final class MobileAccessibilityAuditTests: XCTestCase {
  @MainActor func testListAudit() throws {
    try audit("list", ready: "note-list-panel")
  }

  @MainActor func testSidebarAudit() throws {
    try audit("sidebar", ready: "sidebar-item-inbox")
  }

  @MainActor func testInspectorAudit() throws {
    try audit("properties", ready: "property-row-type-label")
  }

  @MainActor func testEditorAudit() throws {
    try audit("editor", ready: "editor-formatting-toolbar")
  }

  func testRelationshipActionsHaveNativeTargetsAndRemoveOnlyTheirValue() {
    let app = launch("properties", ready: "relationship-add-belongs-to")
    defer { app.terminate() }
    tapVisible("relationship-add-belongs-to", in: app, scroll: "properties-panel")
    let input = element(app, "workspace-relationship-note-title-input")
    tapVisible("workspace-relationship-note-title-input", in: app, scroll: "workspace-relationship-form-scroll")
    input.typeText("Open Source")
    tapVisible("workspace-relationship-note-suggestion-open-source-project", in: app, scroll: "workspace-relationship-form-scroll")
    tapVisible("workspace-relationship-save-action", in: app, scroll: "workspace-relationship-form-scroll")
    XCTAssertTrue(element(app, "workspace-action-sheet").waitForNonExistence(timeout: 5))
    let remove = element(app, "relationship-row-how-i-run-an-open-source-project-remove")
    let open = element(app, "relationship-row-how-i-run-an-open-source-project-open")
    XCTAssertTrue(remove.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(remove.frame.width, 43.99)
    XCTAssertGreaterThanOrEqual(remove.frame.height, 43.99)
    XCTAssertGreaterThanOrEqual(open.frame.height, 43.99)
    XCTAssertFalse(open.frame.intersects(remove.frame))
    remove.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.15)).tap()
    XCTAssertTrue(remove.waitForNonExistence(timeout: 5))
    XCTAssertTrue(element(app, "relationship-row-llm-workflow-open").exists)
    XCTAssertTrue(element(app, "relationship-row-memoria-mvp-open").exists)
    XCTAssertTrue(element(app, "relationship-row-release-notes-open").exists)
  }

  private func tapVisible(_ id: String, in app: XCUIApplication, scroll: String) {
    let target = element(app, id)
    XCTAssertTrue(target.waitForExistence(timeout: 5))
    for _ in 0..<8 where !target.isHittable {
      element(app, scroll).swipeUp()
    }
    XCTAssertTrue(target.isHittable)
    target.tap()
  }

  @MainActor private func audit(_ state: String, ready: String) throws {
    guard #available(iOS 17.0, *) else { throw XCTSkip("Requires native iOS accessibility audits") }
    let app = launch(state, ready: ready)
    defer { app.terminate() }
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.lifetime = .keepAlways
    add(image)
    try app.performAccessibilityAudit { issue in
      let report = XCTAttachment(string: "\(issue.auditType.rawValue): \(issue.detailedDescription)\n\(issue.element?.debugDescription ?? "no element")")
      report.lifetime = .keepAlways
      self.add(report)
      return false
    }
  }

  private func launch(_ state: String, ready: String) -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=\(state)&editorMode=wysiwyg&tabletPanels=all&qaRun=accessibility-audit"]
    app.launch()
    XCTAssertTrue(element(app, ready).waitForExistence(timeout: 30))
    return app
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
