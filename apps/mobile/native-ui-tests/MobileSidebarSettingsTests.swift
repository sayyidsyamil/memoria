import XCTest
import UIKit

final class MobileSidebarSettingsTests: XCTestCase {
  func testSettingsLivesInSidebarAndOpensVaultManagement() {
    let app = launch()
    let sidebar = element(app, "workspace-sidebar-panel")
    XCTAssertTrue(sidebar.waitForExistence(timeout: 30))
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.isHittable)
    XCTAssertTrue(sidebar.frame.contains(settings.frame), "Settings must belong to the sidebar")
    XCTAssertGreaterThan(settings.frame.minY, sidebar.frame.midY)
    XCTAssertGreaterThanOrEqual(settings.frame.height, 44)
    XCTAssertFalse(element(app, "sync-status-bar").exists)
    settings.tap()
    let sheet = element(app, "mobile-settings")
    XCTAssertTrue(sheet.waitForExistence(timeout: 5))
    let vaults = element(app, "settings-manage-vaults")
    if !vaults.isHittable { sheet.swipeUp() }
    XCTAssertTrue(vaults.isHittable)
    vaults.tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
    attachScreenshot()
  }

  func testPhoneSidebarMeetsNoteListWithoutGap() throws {
    let app = launch()
    let phone = element(app, "phone-sidebar-screen")
    try XCTSkipUnless(phone.waitForExistence(timeout: 10), "Phone-only drawer geometry")
    let sidebar = element(app, "workspace-sidebar-panel")
    let list = element(app, "phone-list-slot")
    XCTAssertTrue(list.exists)
    XCTAssertEqual(sidebar.frame.maxX, list.frame.minX, accuracy: 1)
    XCTAssertGreaterThan(app.frame.maxX - sidebar.frame.maxX, 40)
    attachScreenshot()
  }

  func testWorkspaceHasNoPersistentBottomBar() {
    let app = launch()
    XCTAssertTrue(element(app, "workspace-sidebar-panel").waitForExistence(timeout: 30))
    XCTAssertFalse(element(app, "sync-status-bar").exists)
    XCTAssertFalse(element(app, "phone-footer").exists)
    let sidebar = element(app, "workspace-sidebar-panel")
    XCTAssertEqual(sidebar.frame.maxY, app.frame.maxY, accuracy: 1)
    attachScreenshot()
  }

  private func launch() -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=sidebar&forceDesktopPanels=1&qaRun=sidebar-settings"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    return app
  }

  private func attachScreenshot() {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
