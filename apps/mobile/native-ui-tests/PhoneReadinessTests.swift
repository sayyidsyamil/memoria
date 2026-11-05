import XCTest

final class PhoneReadinessTests: XCTestCase {
  override func tearDown() {
    if testRun?.hasSucceeded == false {
      let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      image.name = "phone-readiness-failure"
      image.lifetime = .keepAlways
      add(image)
      let tree = XCTAttachment(string: XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").debugDescription)
      tree.lifetime = .keepAlways
      add(tree)
    }
    super.tearDown()
  }

  func testPropertiesReturnsToTheSameSourceEditor() {
    let app = launch("wysiwyg")
    element(app, "editor-source-action").tap()
    let input = element(app, "editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 15))
    MobilePanelNavigation.openProperties(app)
    XCTAssertTrue(element(app, "phone-properties-screen").waitForExistence(timeout: 5))
    MobilePanelNavigation.back(app)
    XCTAssertTrue(input.waitForExistence(timeout: 5), "Returning from Properties must retain the editor mode")
  }

  func testPropertySaveRemainsAboveTheSoftwareKeyboard() {
    let app = launch("wysiwyg")
    MobilePanelNavigation.openProperties(app)
    let tags = element(app, "property-tags-edit")
    XCTAssertTrue(tags.waitForExistence(timeout: 5))
    tags.tap()
    let value = element(app, "workspace-property-value-input")
    XCTAssertTrue(value.waitForExistence(timeout: 5))
    value.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let save = element(app, "workspace-property-save-action")
    XCTAssertTrue(save.isHittable)
    XCTAssertLessThanOrEqual(save.frame.maxY, app.keyboards.firstMatch.frame.minY)
    element(app, "workspace-property-cancel-action").tap()
  }

  func testLandscapeKeepsCompactFormattingAndOnePropertiesHeader() {
    let app = launch("wysiwyg")
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(element(app, "editor-format-menu-headings").waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "editor-format-heading-6").exists)
    MobilePanelNavigation.openProperties(app)
    XCTAssertTrue(element(app, "phone-properties-screen").waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "properties-toolbar").exists)
    XCUIDevice.shared.orientation = .portrait
  }

  private func launch(_ mode: String) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=editor&editorMode=\(mode)&qaRun=phone-readiness"]
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar").waitForExistence(timeout: 30))
    return app
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
