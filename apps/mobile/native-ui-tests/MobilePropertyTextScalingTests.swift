import XCTest

final class MobilePropertyTextScalingTests: XCTestCase {
  func testPropertyChipsContainScaledText() {
    let app = launchProperties()
    for name in ["type", "status"] {
      let label = element(app, "property-row-\(name)-label")
      let chip = element(app, "property-row-\(name)-edit")
      XCTAssertTrue(chip.isHittable)
      XCTAssertGreaterThanOrEqual(chip.frame.height, label.frame.height,
                                 "Property chip must grow with system text, not clip its contents")
    }
    capture()
  }

  func testMetadataLabelsDoNotWrapMidWord() {
    let app = launchProperties()
    let singleLineHeight = element(app, "property-row-status-label").frame.height
    for name in ["created", "modified"] {
      let label = element(app, "property-row-\(name)-label")
      XCTAssertTrue(label.isHittable)
      XCTAssertEqual(label.frame.height, singleLineHeight, accuracy: 1,
                     "Short metadata labels must remain readable at larger text sizes")
    }
    capture()
  }

  func testStandardTextKeepsHorizontalPropertyRows() {
    let app = launchProperties(category: .large)
    let label = element(app, "property-row-created-label")
    let value = element(app, "property-row-created-value")
    XCTAssertEqual(label.frame.midY, value.frame.midY, accuracy: 1)
    XCTAssertLessThan(label.frame.maxX, value.frame.minX)
    capture()
  }

  private func launchProperties(category: UIContentSizeCategory = .accessibilityLarge) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", category.rawValue, "--memoria-mobile-search",
      "?source=fixture&phoneState=properties&tabletPanels=all&qaRun=property-text-scaling"]
    app.launch()
    XCTAssertTrue(element(app, "property-row-type-label").waitForExistence(timeout: 30))
    if category.isAccessibilityCategory {
      XCTAssertGreaterThan(element(app, "property-row-type-label").frame.height, 30,
                           "The regression must actually exercise larger system text")
    }
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
