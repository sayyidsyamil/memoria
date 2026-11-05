import XCTest
import UIKit

enum MobilePanelNavigation {
  static func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  static func back(_ app: XCUIApplication) {
    let properties = element(app, "phone-properties-screen").exists
    swipe(app, right: true)
    let target = properties ? "phone-editor-screen" : "phone-note-list-screen"
    wait { element(app, target).exists && abs(element(app, target).frame.minX) < 1 }
  }

  static func openSidebar(_ app: XCUIApplication) {
    drag(element(app, "note-list-toolbar"), fromX: 0.3, dx: app.frame.width * 0.6)
    wait { element(app, "sidebar-item-all-notes").isHittable }
  }

  static func openProperties(_ app: XCUIApplication) {
    swipe(app, right: false)
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    let surface = phone ? element(app, "phone-properties-screen") : app
    wait {
      let panel = element(app, "properties-panel")
      return panel.exists && panel.frame.width > 200
        && abs(panel.frame.maxX - surface.frame.maxX) < 1
        && (!phone || abs(panel.frame.minX - surface.frame.minX) < 1)
    }
    XCTContext.runActivity(named: "Properties edge drag") { activity in
      let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      capture.lifetime = .keepAlways
      activity.add(capture)
      let geometry = XCTAttachment(string:
        "app=\(app.frame), surface=\(surface.frame), panel=\(element(app, "properties-panel").frame)")
      geometry.lifetime = .keepAlways
      activity.add(geometry)
    }
  }

  static func toggleProperties(_ app: XCUIApplication) {
    let panel = element(app, "properties-panel")
    if panel.exists {
      drag(panel, fromX: 0.05, dx: panel.frame.width - 20)
      wait { !panel.exists }
    } else {
      openProperties(app)
    }
  }

  static func swipe(_ app: XCUIApplication, right: Bool) {
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    let screen = element(app, "phone-properties-screen").exists ? "phone-properties-screen" : "phone-editor-screen"
    let surface = phone ? element(app, screen) : app
    let start = surface.coordinate(withNormalizedOffset: CGVector(dx: right ? 0.01 : 0.99, dy: 0.4))
    let end = surface.coordinate(withNormalizedOffset: CGVector(dx: right ? 0.85 : 0.1, dy: 0.4))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  static func drag(_ surface: XCUIElement, fromX: Double, dx: Double) {
    let start = surface.coordinate(withNormalizedOffset: CGVector(dx: fromX, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: dx, dy: 0)),
                withVelocity: XCUIGestureVelocity(rawValue: 350), thenHoldForDuration: 0)
  }

  static func wait(_ condition: @escaping () -> Bool) {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
  }
}

final class MobilePanelNavigationTests: XCTestCase {
  func testNoteLongPressSelectsWithoutOpeningEditor() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    let search = "?source=fixture&phoneState=list&qaRun=long-press-selection"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    defer { app.terminate() }
    let row = MobilePanelNavigation.element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    row.press(forDuration: 0.8)
    XCTAssertTrue(MobilePanelNavigation.element(app, "note-list-bulk-action-bar").waitForExistence(timeout: 5))
    MobilePanelNavigation.element(app, "note-row-open-source-project").tap()
    XCTAssertEqual(MobilePanelNavigation.element(app, "note-list-bulk-selected-count").label, "2 selected")
    MobilePanelNavigation.element(app, "note-list-bulk-clear").tap()
    XCTAssertFalse(MobilePanelNavigation.element(app, "note-list-bulk-action-bar").exists)
  }

  func testNavigationRemainsAvailableWithoutToolbarToggles() {
    continueAfterFailure = false
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    XCUIDevice.shared.orientation = phone ? .portrait : .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    let search = "?source=fixture&phoneState=list&editorMode=wysiwyg&tabletPanels=all&qaRun=gesture-only-chrome"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    defer { app.terminate() }
    XCTAssertTrue(MobilePanelNavigation.element(app, "note-list-toolbar").waitForExistence(timeout: 30))
    for id in ["phone-sidebar-action", "tablet-note-list-sidebar-action", "tablet-editor-chrome-toggle"] {
      XCTAssertFalse(MobilePanelNavigation.element(app, id).exists, id)
    }
    if phone { checkPhone(app) } else { checkTablet(app) }
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "gesture-only-toolbar"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func checkPhone(_ app: XCUIApplication) {
    MobilePanelNavigation.openSidebar(app)
    MobilePanelNavigation.element(app, "sidebar-item-all-notes").tap()
    MobilePanelNavigation.element(app, "note-row-workflow-orchestration").tap()
    XCTAssertFalse(MobilePanelNavigation.element(app, "phone-back-action").exists)
    XCTAssertFalse(MobilePanelNavigation.element(app, "phone-properties-action").exists)
    MobilePanelNavigation.openProperties(app)
    MobilePanelNavigation.back(app)
    MobilePanelNavigation.back(app)
  }

  private func checkTablet(_ app: XCUIApplication) {
    XCTAssertFalse(MobilePanelNavigation.element(app, "editor-properties-action").exists)
    MobilePanelNavigation.toggleProperties(app)
    MobilePanelNavigation.toggleProperties(app)
  }
}
