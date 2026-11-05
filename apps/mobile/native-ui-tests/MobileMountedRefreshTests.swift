import XCTest
import UIKit

final class MobileMountedRefreshTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testSameVaultRefreshPreservesScopeSelectionAndSourceMode() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_MOUNTED_REFRESH"] == "1",
                      "Requires a disposable local-qa-refresh vault and backed-up simulator catalog")
    continueAfterFailure = false
    let phone = UIDevice.current.userInterfaceIdiom == .phone
    XCUIDevice.shared.orientation = phone ? .portrait : .landscapeLeft
    app.terminate()
    let search = "?source=native&phoneState=list&editorMode=source&tabletPanels=all&qaRun=mounted-refresh"
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
    XCTAssertEqual(element("editor-toolbar-title").label, "selected.md")
    if phone {
      MobilePanelNavigation.back(app)
      XCTAssertTrue(row.buttons.firstMatch.isSelected)
      MobilePanelNavigation.openSidebar(app)
    }
    element("sidebar-vault-picker").tap()
    let choice = element("quick-select-vault-local-qa-refresh")
    XCTAssertTrue(choice.waitForExistence(timeout: 5))
    choice.tap()
    MobilePanelNavigation.wait { !self.element("sidebar-vault-options").exists }
    if phone { closeSidebar() }
    MobilePanelNavigation.wait { self.element("note-list-toolbar-title").label == "All Notes" }
    if phone {
      XCTAssertTrue(row.buttons.firstMatch.isSelected, "Refresh must retain selection before another note tap")
      row.tap()
    }
    XCTAssertEqual(element("editor-toolbar-title").label, "selected.md")
    let input = element("editor-markdown-input")
    XCTAssertTrue(input.waitForExistence(timeout: 10))
    XCTAssertTrue((input.value as? String ?? "").contains("Selected refresh fixture"))
    let capture = XCTAttachment(screenshot: app.screenshot())
    capture.name = "same-root-refresh-preserved-scope-and-source"
    capture.lifetime = .keepAlways
    add(capture)
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
