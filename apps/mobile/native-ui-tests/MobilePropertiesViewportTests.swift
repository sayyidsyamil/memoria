import XCTest
import UIKit

final class MobilePropertiesViewportTests: XCTestCase {
  func testPropertiesFitBelowHeaderAndKeepBottomActionsReachable() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    XCUIDevice.shared.orientation = phone ? .portrait : .landscapeLeft
    let search = "?source=fixture&phoneState=properties&forceDesktopPanels=1&qaRun=properties-viewport"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    defer { app.terminate() }
    let panel = element(app, "properties-panel")
    XCTAssertTrue(panel.waitForExistence(timeout: 5)
      || element(app, "editor-panel").waitForExistence(timeout: 30))
    if !panel.exists { MobilePanelNavigation.toggleProperties(app) }
    XCTAssertTrue(panel.waitForExistence(timeout: 5))
    let screen = phone ? element(app, "phone-properties-screen") : app.windows.firstMatch
    XCTAssertLessThanOrEqual(panel.frame.maxY, screen.frame.maxY + 1)
    let action = element(app, "property-action-add-relationship")
    for _ in 0..<3 where !action.isHittable || action.frame.maxY > screen.frame.maxY {
      panel.swipeUp()
    }
    XCTAssertTrue(action.isHittable)
    XCTAssertLessThanOrEqual(action.frame.maxY, screen.frame.maxY + 1)
    action.tap()
    XCTAssertTrue(element(app, "workspace-relationship-name-input").waitForExistence(timeout: 5))
    element(app, "workspace-relationship-cancel-action").tap()
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = "properties-within-viewport"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
