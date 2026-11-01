import XCTest

// The host seeds review.md and its referring note in an isolated app-owned vault.
final class TabletVaultBacklinkTests: XCTestCase {
  func testOnDiskBacklinkIsAlignedAndNavigates() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&editorMode=wysiwyg&qaRun=vault-backlink"]
    app.launch()
    let allNotes = element(app, "sidebar-item-all-notes")
    XCTAssertTrue(allNotes.waitForExistence(timeout: 60))
    allNotes.tap()
    element(app, "note-row-review.md").tap()
    let addProperty = element(app, "properties-toolbar-add")
    if !addProperty.isHittable { MobilePanelNavigation.toggleProperties(app) }
    let backlink = element(app, "inspector-reference-row-codex-prepared-action-qa")
    XCTAssertTrue(backlink.waitForExistence(timeout: 10))
    XCTAssertTrue(backlink.isHittable)
    XCTAssertGreaterThan(backlink.frame.width, 200)
    XCTAssertGreaterThanOrEqual(backlink.frame.height, 28)
    let icon = backlink.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "phosphor-react-native-")).firstMatch
    XCTAssertTrue(icon.exists)
    XCTAssertEqual(icon.frame.midY, backlink.frame.midY, accuracy: 1)
    XCTAssertGreaterThanOrEqual(icon.frame.minX - backlink.frame.minX, 6)
    let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    capture.lifetime = .keepAlways
    add(capture)
    backlink.tap()
    XCTAssertEqual(element(app, "editor-toolbar-title").label, "codex-prepared-action-qa.md")
    XCTAssertTrue(app.webViews.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Original full body for native Undo.")).firstMatch.waitForExistence(timeout: 10))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
