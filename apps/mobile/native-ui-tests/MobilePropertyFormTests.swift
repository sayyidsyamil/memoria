import XCTest
import UIKit

final class MobilePropertyFormTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testPropertySaveAndCancelFromPortrait() {
    verifyProperty(from: .portrait, to: .landscapeLeft)
  }

  func testPropertySaveAndCancelFromLandscape() {
    verifyProperty(from: .landscapeLeft, to: .portrait)
  }

  func testExistingRelationshipAcceptsAnotherValueFromPortrait() {
    verifyRelationship(from: .portrait, to: .landscapeLeft)
  }

  func testExistingRelationshipAcceptsAnotherValueFromLandscape() {
    verifyRelationship(from: .landscapeLeft, to: .portrait)
  }

  private func verifyProperty(from: UIDeviceOrientation, to: UIDeviceOrientation) {
    let app = launch(from)
    tapVisible("property-placeholder-type-derived-priority", in: app, scroll: "properties-panel")
    let input = element(app, "workspace-property-value-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    input.typeText("High priority")
    assertKeyboardClearance(app, field: input)
    rotate(app, to: to)
    assertKeyboardClearance(app, field: input)
    input.typeText(" after rotation")
    XCTAssertEqual(input.value as? String, "High priority after rotation")
    element(app, "workspace-property-save-action").tap()
    XCTAssertTrue(element(app, "workspace-action-sheet").waitForNonExistence(timeout: 5))
    let saved = element(app, "property-row-priority-edit")
    XCTAssertEqual(saved.label, "Priority: High priority after rotation")
    tapVisible("property-row-priority-edit", in: app, scroll: "properties-panel")
    input.tap()
    input.typeText(" cancelled")
    element(app, "workspace-property-cancel-action").tap()
    XCTAssertTrue(element(app, "workspace-action-sheet").waitForNonExistence(timeout: 5))
    XCTAssertEqual(saved.label, "Priority: High priority after rotation", "Cancel must preserve the saved value")
    capture("property-save-cancel-after-rotation")
  }

  private func verifyRelationship(from: UIDeviceOrientation, to: UIDeviceOrientation) {
    let app = launch(from)
    tapVisible("relationship-add-belongs-to", in: app, scroll: "properties-panel")
    let name = element(app, "workspace-relationship-name-input")
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    XCTAssertEqual(name.value as? String, "Belongs to")
    let target = element(app, "workspace-relationship-note-title-input")
    tapVisible("workspace-relationship-note-title-input", in: app, scroll: "workspace-relationship-form-scroll")
    target.typeText("Open Source")
    tapVisible("workspace-relationship-note-suggestion-open-source-project", in: app, scroll: "workspace-relationship-form-scroll")
    rotate(app, to: to)
    XCTAssertEqual(target.value as? String, "How I Run an Open Source Project")
    XCTAssertEqual(name.value as? String, "Belongs to")
    tapVisible("workspace-relationship-save-action", in: app, scroll: "workspace-relationship-form-scroll")
    XCTAssertTrue(element(app, "workspace-action-sheet").waitForNonExistence(timeout: 5))
    for id in ["llm-workflow", "memoria-mvp", "how-i-run-an-open-source-project"] {
      XCTAssertTrue(element(app, "relationship-row-\(id)-open").exists,
                    "Adding a relationship value must retain the existing values")
    }
    capture("existing-relationship-add-after-rotation")
  }

  private func launch(_ orientation: UIDeviceOrientation) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = orientation
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=properties&tabletPanels=all&forceDesktopPanels=1&qaRun=property-forms"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    rotate(app, to: orientation)
    XCTAssertTrue(element(app, "properties-panel").waitForExistence(timeout: 30))
    return app
  }

  private func rotate(_ app: XCUIApplication, to orientation: UIDeviceOrientation) {
    XCUIDevice.shared.orientation = orientation
    let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      (app.frame.width < app.frame.height) == (orientation == .portrait)
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 10), .completed)
  }

  private func assertKeyboardClearance(_ app: XCUIApplication, field: XCUIElement) {
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
    let save = element(app, "workspace-property-save-action")
    let toolbar = element(app, "workspace-action-sheet-toolbar")
    let clear = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let bottom = save.frame.minY >= toolbar.frame.maxY
        ? min(save.frame.minY, keyboard.frame.minY) : keyboard.frame.minY
      return field.isHittable && save.isHittable && field.frame.minY >= toolbar.frame.maxY - 1
        && field.frame.maxY <= bottom + 1 && save.frame.maxY <= keyboard.frame.minY + 1
    }, object: nil)
    let result = XCTWaiter.wait(for: [clear], timeout: 10)
    capture("property-keyboard-clearance")
    XCTAssertEqual(result, .completed,
      "Field \(field.frame), save \(save.frame), toolbar \(toolbar.frame), keyboard \(keyboard.frame)")
    XCTAssertGreaterThanOrEqual(save.frame.height, 43.99)
  }

  private func tapVisible(_ id: String, in app: XCUIApplication, scroll: String) {
    let target = element(app, id)
    XCTAssertTrue(target.waitForExistence(timeout: 5))
    for _ in 0..<12 where !target.isHittable {
      let surface = element(app, scroll)
      let up = target.frame.midY > surface.frame.midY
      let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.7 : 0.3))
      let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.35 : 0.65))
      start.press(forDuration: 0.05, thenDragTo: end)
    }
    if !target.isHittable { capture("unreachable-\(id)") }
    XCTAssertTrue(target.isHittable, id)
    target.tap()
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    MobilePanelNavigation.element(app, id)
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
