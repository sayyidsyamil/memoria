import XCTest

final class PhoneSafeAreaTests: XCTestCase {
  func testFullHeightWorkspaceAndPanelSafeArea() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=phone-safe-area"]
    app.launch()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    XCTAssertFalse(element(app, "phone-footer").exists)
    XCTAssertFalse(element(app, "sync-status-bar").exists)
    let list = element(app, "phone-note-list-screen")
    XCTAssertEqual(list.frame.maxY, app.frame.maxY, accuracy: 1)
    verifyTop(app)
    row.tap()
    XCTAssertTrue(element(app, "editor-toolbar").waitForExistence(timeout: 5))
    verifyTop(app)
    MobilePanelNavigation.openProperties(app)
    XCTAssertTrue(element(app, "phone-properties-screen").waitForExistence(timeout: 5))
    verifyTop(app)
    MobilePanelNavigation.back(app)
    MobilePanelNavigation.back(app)
    MobilePanelNavigation.openSidebar(app)
    XCTAssertTrue(element(app, "phone-sidebar-screen").waitForExistence(timeout: 5))
    verifyTop(app)
  }

  private func verifyTop(_ app: XCUIApplication) {
    let inset = element(app, "phone-top-inset")
    XCTAssertEqual(inset.frame.minY, app.frame.minY, accuracy: 1)
    XCTAssertGreaterThan(inset.frame.height, 40)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
