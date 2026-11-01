import XCTest
import UIKit

final class MobilePropertyPlaceholderTests: XCTestCase {
  func testEmptyPropertyHasTrailingActionAndOpensItsEditor() {
    let app = launchProperties()
    defer { app.terminate() }
    let row = element(app, "property-placeholder-type-derived-priority")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    scrollTo(row, in: app)
    XCTAssertTrue(row.isHittable)
    let action = row.staticTexts.matching(NSPredicate(format: "label == %@", "Add property")).firstMatch
    XCTAssertTrue(action.exists)
    let label = element(app, "property-placeholder-type-derived-priority-label")
    XCTAssertGreaterThanOrEqual(action.frame.minX, label.frame.maxX)
    XCTAssertLessThanOrEqual(action.frame.maxX, row.frame.maxX)
    let panel = element(app, "properties-panel")
    XCTAssertTrue(panel.frame.contains(row.frame))
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = "empty-properties-trailing-action"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let detail = XCTAttachment(screenshot: row.screenshot())
    detail.name = "empty-property-row"
    detail.lifetime = .keepAlways
    add(detail)
    row.tap()
    XCTAssertTrue(element(app, "workspace-property-name-input").waitForExistence(timeout: 5))
    XCTAssertEqual(element(app, "workspace-property-name-input").value as? String, "Priority")
    element(app, "workspace-property-cancel-action").tap()
    XCTAssertTrue(row.isHittable)
  }

  func testPopulatedRelationshipsPrecedePhoneSuggestionsWithoutChangingTabletOrder() {
    let app = launchProperties()
    defer { app.terminate() }
    let relationship = element(app, "property-section-belongsTo")
    let placeholder = element(app, "property-placeholder-type-derived-priority")
    XCTAssertTrue(relationship.waitForExistence(timeout: 5))
    XCTAssertTrue(placeholder.exists)
    XCTAssertGreaterThan(relationship.frame.height, 0)
    XCTAssertGreaterThan(placeholder.frame.height, 0)
    if UIDevice.current.userInterfaceIdiom == .phone {
      XCTAssertLessThan(relationship.frame.maxY, placeholder.frame.minY)
    } else {
      XCTAssertLessThan(placeholder.frame.maxY, relationship.frame.minY)
    }
  }

  private func launchProperties() -> XCUIApplication {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let search = "?source=fixture&phoneState=properties&forceDesktopPanels=1&qaRun=property-placeholder"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element(app, "properties-panel").waitForExistence(timeout: 5)
      || element(app, "editor-panel").waitForExistence(timeout: 30))
    if !element(app, "properties-panel").exists { MobilePanelNavigation.toggleProperties(app) }
    return app
  }

  private func scrollTo(_ row: XCUIElement, in app: XCUIApplication) {
    let panel = element(app, "properties-panel")
    for _ in 0..<8 where !row.isHittable || !panel.frame.contains(row.frame) {
      panel.swipeUp()
    }
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
