import XCTest

final class TabletSourceFindTests: XCTestCase {
  func testFindScrollsLongSourceAndPreservesFrontmatter() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_SOURCE_FIND"] == "1", "Requires an isolated host-prepared source vault")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    // The host prepares an isolated long-source vault and restores the catalog afterward.
    app.launchArguments = ["--memoria-mobile-search", "?source=native&editorMode=source&qaRun=source-find-long"]
    app.launch()
    let input = element(app, "editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 30))
    waitUntil { (input.value as? String ?? "").hasPrefix("---") }
    let original = input.value as? String ?? ""
    XCTAssertTrue(original.hasPrefix("---"))
    XCTAssertTrue(original.contains("QA_UNIQUE_END_TOKEN"))
    openFind(app)
    let field = element(app, "workspace-find-input")
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("---")
    let count = element(app, "workspace-find-count")
    waitUntil { count.label.hasPrefix("1 /") }
    let syntax = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "QA_UNIQUE_END_TOKEN")).firstMatch
    XCTAssertTrue(syntax.exists)
    let firstY = syntax.frame.minY
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3) + "QA_UNIQUE_END_TOKEN")
    waitUntil { count.label == "1 / 1" }
    waitUntil { syntax.frame.minY < firstY - 400 }
    XCTAssertTrue(field.isHittable)
    capture()
    element(app, "workspace-find-show-replace").tap()
    let replacement = element(app, "workspace-replace-input")
    replacement.tap()
    replacement.typeText("QA_REPLACED_TOKEN")
    element(app, "workspace-replace-all").tap()
    waitUntil { count.label == "No matches" }
    let result = input.value as? String ?? ""
    XCTAssertTrue(result.contains("QA_REPLACED_TOKEN"))
    XCTAssertEqual(result, original.replacingOccurrences(of: "QA_UNIQUE_END_TOKEN", with: "QA_REPLACED_TOKEN"))
  }

  private func openFind(_ app: XCUIApplication) {
    element(app, "editor-more-action").tap()
    element(app, "workspace-action-group-edit").tap()
    element(app, "workspace-action-find-in-note").tap()
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func waitUntil(_ condition: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in condition() }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }

  private func capture() {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.lifetime = .keepAlways
    add(image)
  }
}
