import XCTest

final class MobileNavigationStateTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testSourceSelectionSurvivesPropertiesAndRotation() {
    launchSourceFixture()
    element("note-list-create-action").tap()
    let input = element("editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 10))
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    app.typeText("Selection title\nPrefix ")
    element("editor-format-bold").tap()
    XCTAssertTrue(content(input).contains("Prefix **bold text**"))

    visitPropertiesAndReturn()
    let phone = element("phone-editor-screen").exists
    XCUIDevice.shared.orientation = phone ? .landscapeLeft : .portrait
    waitUntil { (self.app.frame.width > self.app.frame.height) == phone }
    let italic = element("editor-format-italic")
    XCTAssertTrue(italic.isHittable)
    italic.tap()
    waitUntil { self.content(input).contains("Prefix ***bold text***") }
    XCTAssertTrue(content(input).contains("type: Note"))
    XCTAssertFalse(content(input).contains("italic text"), "The original selection, not a new insertion, must be formatted")
    attachScreen("source-selection-after-navigation")
  }

  func testPhoneListPositionSurvivesOpeningNoteAndSidebar() {
    launchSourceFixture()
    XCUIDevice.shared.orientation = .landscapeLeft
    waitUntil { self.app.frame.width > self.app.frame.height }
    let list = element("note-list-panel")
    let row = element("note-row-release-2026-05-02")
    let initialY = row.frame.minY
    list.swipeUp()
    XCTAssertTrue(row.isHittable)
    let rowY = row.frame.minY
    XCTAssertLessThan(rowY, initialY - 20, "The test must retain a genuinely scrolled list")
    row.tap()
    XCTAssertTrue(element("editor-markdown-input").waitForExistence(timeout: 10))
    let editor = element("phone-editor-screen")
    XCTAssertTrue(editor.exists)
    print("PHONE_LANDSCAPE_EDITOR_FRAME \(editor.frame); app \(app.frame)")
    drag(editor, from: 0.99, to: 0.1)
    let properties = element("phone-properties-screen")
    XCTAssertTrue(properties.waitForExistence(timeout: 5))
    drag(properties, from: 0.1, to: 0.9)
    waitUntil { editor.isHittable }
    drag(editor, from: 0.01, to: 0.9)
    attachScreen("landscape-editor-after-back-swipe")
    waitUntil { row.exists && row.isHittable }
    XCTAssertEqual(row.frame.minY, rowY, accuracy: 2)
    drag(element("phone-note-list-screen"), from: 0.2, to: 0.85, y: 0.025)
    XCTAssertTrue(element("phone-sidebar-screen").waitForExistence(timeout: 5))
    drag(element("phone-sidebar-screen"), from: 0.8, to: 0.1)
    waitUntil { row.exists && row.isHittable }
    XCTAssertEqual(row.frame.minY, rowY, accuracy: 2)
    attachScreen("list-position-after-navigation")
  }

  private func launchSourceFixture() {
    continueAfterFailure = false
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=list&editorMode=source&qaRun=navigation-state"]
    app.launch()
    XCTAssertTrue(element("note-list-create-action").waitForExistence(timeout: 30))
    if app.frame.width > 600 {
      XCUIDevice.shared.orientation = .landscapeLeft
      waitUntil { self.app.frame.width > self.app.frame.height }
    }
  }

  private func visitPropertiesAndReturn() {
    if element("phone-editor-screen").exists {
      MobilePanelNavigation.openProperties(app)
      XCTAssertTrue(element("phone-properties-screen").waitForExistence(timeout: 5))
      drag(element("phone-properties-screen"), from: 0.1, to: 0.9)
      waitUntil { self.element("editor-markdown-input").isHittable }
    } else {
      let wasVisible = element("properties-panel").exists
      MobilePanelNavigation.toggleProperties(app)
      waitUntil { self.element("properties-panel").exists != wasVisible }
      MobilePanelNavigation.toggleProperties(app)
      waitUntil { self.element("properties-panel").exists == wasVisible }
    }
  }

  private func content(_ input: XCUIElement) -> String {
    input.value as? String ?? ""
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func drag(_ panel: XCUIElement, from: Double, to: Double, y: Double = 0.4) {
    let start = panel.coordinate(withNormalizedOffset: CGVector(dx: from, dy: y))
    start.press(forDuration: 0.05, thenDragTo: panel.coordinate(withNormalizedOffset: CGVector(dx: to, dy: y)))
  }

  private func waitUntil(_ condition: @escaping () -> Bool) {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed)
  }

  private func attachScreen(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
