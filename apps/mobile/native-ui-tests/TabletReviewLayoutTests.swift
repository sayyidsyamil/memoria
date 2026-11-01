import XCTest

final class TabletReviewLayoutTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testTypeVisibilityRowsHaveNativeSpacing() {
    let app = launchFixture()
    let toggle = element(app, "sidebar-section-visibility-types")
    XCTAssertTrue(toggle.waitForExistence(timeout: 30))
    toggle.tap()
    let row = element(app, "workspace-type-visibility-essay")
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(row.frame.width, 250)
    XCTAssertEqual(row.frame.height, 52, accuracy: 1)
    let next = element(app, "workspace-type-visibility-procedure")
    XCTAssertGreaterThanOrEqual(next.frame.minY - row.frame.maxY, 4)
    row.tap()
    XCTAssertTrue(row.exists)
    record(app, name: "type-visibility")
  }

  func testInspectorExposesPropertyAndRelationshipAddition() {
    let app = launchFixture()
    XCTAssertTrue(element(app, "editor-toolbar").waitForExistence(timeout: 30))
    if !element(app, "properties-toolbar-add").isHittable { MobilePanelNavigation.openProperties(app) }
    let addProperty = element(app, "properties-toolbar-add")
    XCTAssertTrue(addProperty.waitForExistence(timeout: 5))
    XCTAssertTrue(addProperty.isHittable)
    let addRelationship = element(app, "relationship-add-belongs-to")
    XCTAssertTrue(addRelationship.exists)
    addRelationship.tap()
    XCTAssertTrue(element(app, "workspace-action-sheet-addRelationship").waitForExistence(timeout: 5))
    record(app, name: "add-existing-relationship")
  }

  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&qaRun=review-layout"]
    app.launch()
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func record(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
