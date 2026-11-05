import XCTest

final class MobileFormKeyboardTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testViewFormFooterStaysReachableFromPortrait() {
    verifyForm(.portrait, rotatingTo: .landscapeLeft)
  }

  func testViewFormFooterStaysReachableFromLandscape() {
    verifyForm(.landscapeLeft, rotatingTo: .portrait)
  }

  func testEditViewActionsDoNotCrowdLandscapeFields() {
    verifyForm(.landscapeLeft, rotatingTo: .portrait, action: "editView")
  }

  private func verifyForm(_ orientation: UIDeviceOrientation, rotatingTo other: UIDeviceOrientation,
    action: String = "createView") {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = orientation
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=list&actionSheet=\(action)&qaRun=modal-keyboard"]
    app.launch()
    XCUIDevice.shared.orientation = orientation
    let fieldID = action == "editView" ? "workspace-edit-view-name-input" : "workspace-create-view-name-input"
    let submitTitle = action == "editView" ? "Save" : "Create"
    let field = element(app, fieldID)
    XCTAssertTrue(field.waitForExistence(timeout: 30))
    field.tap()
    let initialValue = action == "editView" ? field.value as? String ?? "" : ""
    field.typeText("Keyboard proof")
    assertFooter(app, submitTitle)
    assertFocusedFieldVisible(app, fieldID, submitTitle)
    XCUIDevice.shared.orientation = other
    let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      (app.frame.width < app.frame.height) == (other == .portrait)
    }, object: nil)
    wait(for: [rotated], timeout: 10)
    assertFooter(app, submitTitle)
    assertFocusedFieldVisible(app, fieldID, submitTitle)
    field.typeText(" after rotation")
    XCTAssertEqual(field.value as? String, initialValue + "Keyboard proof after rotation")
    if action == "editView", UIDevice.current.userInterfaceIdiom == .phone {
      assertSecondaryActionsReachable(app)
    }
    app.buttons["Cancel"].firstMatch.tap()
    XCTAssertTrue(element(app, "workspace-action-sheet-\(action)").waitForNonExistence(timeout: 5))
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
  }

  private func assertSecondaryActionsReachable(_ app: XCUIApplication) {
    let scroll = element(app, "workspace-single-field-scroll")
    let delete = element(app, "workspace-delete-view-action")
    for _ in 0..<12 where !delete.isHittable {
      scroll.swipeUp()
    }
    XCTAssertTrue(delete.isHittable)
    for id in ["workspace-delete-view-action", "workspace-move-view-up-action", "workspace-move-view-down-action"] {
      let action = element(app, id)
      XCTAssertGreaterThanOrEqual(action.frame.minX, scroll.frame.minX - 1)
      XCTAssertLessThanOrEqual(action.frame.maxX, scroll.frame.maxX + 1)
      XCTAssertLessThanOrEqual(action.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
    }
  }

  private func assertFocusedFieldVisible(_ app: XCUIApplication, _ fieldID: String, _ submitTitle: String) {
    let field = element(app, fieldID)
    let toolbar = element(app, "workspace-action-sheet-toolbar")
    let keyboard = app.keyboards.firstMatch
    let create = app.buttons[submitTitle].firstMatch
    let geometry = XCTAttachment(string:
      "Field \(field.frame), toolbar \(toolbar.frame), create \(create.frame), keyboard \(keyboard.frame), hittable \(field.isHittable)")
    geometry.lifetime = .keepAlways
    add(geometry)
    let fieldVisible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let bottom = create.frame.minY >= toolbar.frame.maxY
        ? min(create.frame.minY, keyboard.frame.minY) : keyboard.frame.minY
      return field.frame.height > 0
        && field.frame.minY >= toolbar.frame.maxY - 1
        && field.frame.maxY <= bottom + 1
        && field.isHittable
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [fieldVisible], timeout: 10), .completed,
      "Field \(field.frame), toolbar \(toolbar.frame), create \(create.frame), keyboard \(keyboard.frame), hittable \(field.isHittable)")
  }

  private func assertFooter(_ app: XCUIApplication, _ submitTitle: String) {
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(keyboard.frame.height, 150)
    let create = app.buttons[submitTitle].firstMatch
    let aboveKeyboard = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      create.frame.maxY <= keyboard.frame.minY + 1
    }, object: nil)
    wait(for: [aboveKeyboard], timeout: 10)
    XCTAssertTrue(create.isEnabled)
    XCTAssertTrue(create.isHittable)
    let toolbar = element(app, "workspace-action-sheet-toolbar")
    let statusBar = app.statusBars.firstMatch
    if statusBar.exists {
      XCTAssertGreaterThanOrEqual(toolbar.frame.minY, statusBar.frame.maxY - 1)
    }
    // Rotated UIKit frames can differ by a few millionths of a point.
    XCTAssertGreaterThanOrEqual(create.frame.height, 43.99)
    XCTAssertGreaterThanOrEqual(create.frame.width, 43.99)
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
