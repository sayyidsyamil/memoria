import UIKit
import XCTest

final class MobileSidebarSectionsTests: XCTestCase {
  func testSectionLabelsCollapseAndRestoreTheirOwnContent() {
    let app = launchFixture()
    let cases = [("favorites", "sidebar-item-personal-journal"), ("views", "sidebar-item-view-active-procedures"),
      ("types", "sidebar-item-essays"), ("folders", "Writing")]
    for (section, childID) in cases {
      let header = element(app, "sidebar-section-toggle-\(section)")
      let child = section == "folders" ? app.buttons[childID] : element(app, childID)
      reveal(header, app)
      XCTAssertTrue(child.exists)
      header.tap()
      XCTAssertFalse(child.exists, "Only the collapsed group's children disappear")
      header.tap()
      XCTAssertTrue(child.waitForExistence(timeout: 3))
      XCTAssertTrue(element(app, "sidebar-item-inbox").exists)
    }
    attachScreen("expanded-sidebar-sections")
  }

  func testCollapsedTypeHeaderKeepsVisibilityActionIndependent() {
    let app = launchFixture()
    let header = element(app, "sidebar-section-toggle-types")
    reveal(header, app)
    header.tap()
    XCTAssertFalse(element(app, "sidebar-item-essays").exists)
    let visibility = element(app, "sidebar-section-visibility-types")
    XCTAssertTrue(visibility.isHittable)
    visibility.tap()
    XCTAssertFalse(element(app, "sidebar-item-essays").exists)
    XCTAssertTrue(element(app, "workspace-type-visibility-list").waitForExistence(timeout: 5))
    attachScreen("collapsed-section-independent-action")
  }

  func testFloatingControlsAllowLastFolderToScrollClear() {
    let app = launchFixture()
    let settings = element(app, "open-mobile-settings")
    let footer = element(app, "sidebar-floating-controls")
    let scroll = element(app, "sidebar-scroll")
    XCTAssertGreaterThan(scroll.frame.maxY, settings.frame.maxY, "Scroll viewport extends behind floating controls")
    let last = app.buttons.matching(NSPredicate(format: "label == %@", "PDFs")).firstMatch
    for _ in 0..<4 where !last.isHittable || last.frame.maxY > footer.frame.minY { scroll.swipeUp() }
    XCTAssertTrue(last.isHittable)
    XCTAssertLessThanOrEqual(last.frame.maxY, footer.frame.minY + 1)
    XCTAssertTrue(settings.isHittable)
    XCTAssertGreaterThanOrEqual(settings.frame.width, 44)
    attachScreen("last-folder-clears-floating-controls")
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .portrait : .landscapeLeft
    let header = element(app, "note-list-toolbar")
    if !header.exists {
      let sidebar = element(app, "workspace-sidebar-panel")
      MobilePanelNavigation.drag(sidebar, fromX: 0.8, dx: -sidebar.frame.width * 0.8)
    }
    XCTAssertTrue(header.waitForExistence(timeout: 5))
    let start = header.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 280, dy: 0)),
      withVelocity: XCUIGestureVelocity(rawValue: 250), thenHoldForDuration: 0)
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    XCTAssertTrue(element(app, "workspace-sidebar-panel").frame.contains(settings.frame))
    attachScreen("floating-sidebar-rotation")
  }

  private func launchFixture() -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&scenario=folder-tree&phoneState=sidebar&qaRun=sidebar-sections-\(UUID().uuidString)"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    addTeardownBlock { app.terminate() }
    app.launch()
    XCTAssertTrue(element(app, "workspace-sidebar-panel").waitForExistence(timeout: 30))
    return app
  }

  private func reveal(_ item: XCUIElement, _ app: XCUIApplication) {
    for _ in 0..<3 where !item.isHittable { element(app, "sidebar-scroll").swipeUp() }
    XCTAssertTrue(item.isHittable)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func attachScreen(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }
}
