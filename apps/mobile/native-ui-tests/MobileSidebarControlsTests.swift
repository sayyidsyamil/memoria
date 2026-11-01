import XCTest
import UIKit

final class MobileSidebarControlsTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func setUp() {
    super.setUp()
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    app.launchArguments = ["--memoria-mobile-search",
      "?source=fixture&phoneState=sidebar&qaRun=sidebar-controls"]
    app.launch()
    XCTAssertTrue(element("workspace-sidebar-panel").waitForExistence(timeout: 30))
  }

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testSidebarActionsAndTypeCounts() {
    XCTAssertFalse(element("sidebar-section-count-types").exists)
    XCTAssertTrue(element("sidebar-item-essays-count").exists)
    let command = element("sidebar-command-palette-action")
    let settings = element("open-mobile-settings")
    XCTAssertLessThan(command.frame.maxX, settings.frame.minX)
    XCTAssertEqual(command.frame.midY, settings.frame.midY, accuracy: 1)
    XCTAssertEqual(command.frame.height, command.frame.width, accuracy: 1)
    XCTAssertEqual(settings.frame.height, settings.frame.width, accuracy: 1)
    XCTAssertGreaterThanOrEqual(command.frame.height, 44)
    XCTAssertTrue(command.isHittable)
    XCTAssertTrue(settings.isHittable)
    attachScreen()
    command.tap()
    XCTAssertTrue(element("mobile-command-palette").waitForExistence(timeout: 5))
  }

  func testHeaderOpensVaultSelection() {
    let picker = element("sidebar-vault-picker")
    XCTAssertTrue(picker.isHittable)
    XCTAssertTrue(element("sidebar-toolbar").frame.contains(picker.frame))
    picker.tap()
    XCTAssertTrue(element("vault-manager").waitForExistence(timeout: 5))
    attachScreen()
  }

  private func element(_ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func attachScreen() {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
