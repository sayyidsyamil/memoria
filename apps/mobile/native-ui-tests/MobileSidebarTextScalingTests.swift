import XCTest

final class MobileSidebarTextScalingTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    super.tearDown()
  }

  func testSidebarRowsGrowWithSystemText() {
    let app = launchSidebar(category: .accessibilityLarge)
    for name in ["inbox", "all-notes", "archive"] {
      let row = element(app, "sidebar-item-\(name)")
      let label = element(app, "sidebar-item-\(name)-label")
      XCTAssertGreaterThan(label.frame.height, 30, "Large text must not be clipped into a fixed-height row")
      XCTAssertGreaterThanOrEqual(label.frame.minY, row.frame.minY)
      XCTAssertLessThanOrEqual(label.frame.maxY, row.frame.maxY)
      XCTAssertTrue(row.isHittable)
    }
    capture()
  }

  func testSidebarCountsGrowWithSystemText() {
    let app = launchSidebar(category: .accessibilityLarge)
    for name in ["inbox", "all-notes", "archive"] {
      let count = element(app, "sidebar-item-\(name)-count")
      XCTAssertGreaterThan(count.frame.height, 30, "Count pills must contain the enlarged line height")
    }
    capture()
  }

  func testStandardSidebarKeepsDesktopDerivedSpacing() {
    let app = launchSidebar(category: .large)
    let row = element(app, "sidebar-item-inbox")
    let count = element(app, "sidebar-item-inbox-count")
    XCTAssertEqual(count.frame.height, 24, accuracy: 1)
    XCTAssertEqual(row.frame.height, 38.4, accuracy: 1)
    let title = element(app, "sidebar-section-title-text-types")
    let visibility = element(app, "sidebar-section-visibility-types")
    XCTAssertEqual(title.frame.midY, visibility.frame.midY, accuracy: 1)
    capture()
  }

  func testLargeSectionHeadingKeepsItsWordAndActionsVisible() {
    let app = launchSidebar(category: .accessibilityLarge)
    let title = element(app, "sidebar-section-title-text-types")
    let reference = element(app, "sidebar-section-title-text-favorites")
    let create = element(app, "sidebar-section-create-types")
    let visibility = element(app, "sidebar-section-visibility-types")
    XCTAssertEqual(title.frame.height, reference.frame.height, accuracy: 1,
      "Types must not wrap midword to make room for its actions")
    XCTAssertTrue(create.isHittable)
    XCTAssertTrue(visibility.isHittable)
    XCTAssertFalse(title.frame.intersects(create.frame))
    XCTAssertFalse(title.frame.intersects(visibility.frame))
    capture()
  }

  private func launchSidebar(category: UIContentSizeCategory) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", category.rawValue, "--memoria-mobile-search",
      "?source=fixture&phoneState=sidebar&tabletPanels=all&qaRun=sidebar-text-scaling"]
    app.launch()
    XCTAssertTrue(element(app, "sidebar-item-inbox").waitForExistence(timeout: 30))
    return app
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func capture() {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
