import XCTest
import UIKit

final class MobileReloadCommandTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testReloadCommandUsesPreparedVaultAndKeepsCurrentScope() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_MOUNTED_REFRESH"] == "1",
                      "Requires a disposable local-qa-refresh vault and backed-up simulator catalog")
    continueAfterFailure = false
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    XCUIDevice.shared.orientation = phone ? .portrait : .landscapeLeft
    app.terminate()
    let search = "?source=native&phoneState=list&editorMode=source&tabletPanels=all&qaRun=reload-command"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element("note-list-toolbar").waitForExistence(timeout: 40))
    if phone { MobilePanelNavigation.openSidebar(app) }
    element("sidebar-item-all-notes").tap()
    let row = element("note-row-selected.md")
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    XCTAssertTrue(element("editor-markdown-input").waitForExistence(timeout: 10))
    // The host adds a file to this disposable vault after the original index loads.
    print("MEMORIA_QA_RELOAD_READY")
    if phone {
      MobilePanelNavigation.back(app)
      XCTAssertTrue(row.buttons.firstMatch.isSelected)
      MobilePanelNavigation.openSidebar(app)
    }
    reloadVault()
    MobilePanelNavigation.wait { !self.element("mobile-command-palette").exists }
    if phone { closeSidebar() }
    MobilePanelNavigation.wait { self.element("note-list-toolbar-title").label == "All Notes" }
    XCTAssertTrue(element("note-row-reloaded.md").waitForExistence(timeout: 10),
                  "Reload must discover the host's new file, not reuse the consumed launch index")
    XCTAssertFalse(element("vault-manager").exists)
    if phone {
      XCTAssertTrue(row.buttons.firstMatch.isSelected)
      row.tap()
    }
    XCTAssertEqual(element("editor-toolbar-title").label, "selected.md")
    let input = element("editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 10))
    XCTAssertTrue((input.value as? String ?? "").contains("Selected refresh fixture"))
    let capture = XCTAttachment(screenshot: app.screenshot())
    capture.name = "native-reload-command"
    capture.lifetime = .keepAlways
    add(capture)
  }

  private func reloadVault() {
    element("sidebar-command-palette-action").tap()
    let searchInput = element("mobile-command-palette-input")
    XCTAssertTrue(searchInput.waitForExistence(timeout: 5))
    searchInput.tap()
    app.typeText("Reload Vault")
    let reload = element("mobile-command-palette-command-vault-reload")
    XCTAssertTrue(reload.waitForExistence(timeout: 5))
    reload.tap()
  }

  private func closeSidebar() {
    let sidebar = element("phone-sidebar-screen")
    let start = sidebar.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.4))
    start.press(forDuration: 0.05,
                thenDragTo: sidebar.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.4)))
    MobilePanelNavigation.wait { abs(self.element("phone-note-list-screen").frame.minX) < 1 }
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
