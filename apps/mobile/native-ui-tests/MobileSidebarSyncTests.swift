import UIKit
import XCTest

final class MobileSidebarSyncTests: XCTestCase {
  func testLocalOnlyPillOpensVaultManagement() throws {
    let app = try launchOwnedVault()
    assertPillLayout(app)
    XCTAssertEqual(element(app, "sidebar-sync-destination").label, "Local only")
    XCTAssertEqual(element(app, "sidebar-sync-state").label, "Not linked")
    XCTAssertFalse(element(app, "sidebar-sync-last-success").exists)
    element(app, "sidebar-sync-action").tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
    attachScreen("local-only-sync-management")
  }

  func testLinkedFolderPillSyncsAndUpdatesLastSuccess() throws {
    let app = try launchOwnedVault()
    XCTAssertEqual(element(app, "sidebar-sync-destination").label, "Linked folder")
    element(app, "sidebar-sync-action").tap()
    waitUntil { self.element(app, "sidebar-sync-state").label == "now" }
    XCTAssertFalse(element(app, "sidebar-sync-last-success").exists)
    assertPillLayout(app)
    attachScreen("linked-folder-sync-success")
    XCUIDevice.shared.orientation = .landscapeLeft
    waitUntil { app.frame.width > app.frame.height }
    assertPillLayout(app)
    attachScreen("linked-folder-sync-landscape")
  }

  func testGitFailureKeepsLastSuccessfulSync() throws {
    let app = try launchOwnedVault()
    XCTAssertEqual(element(app, "sidebar-sync-destination").label, "GitHub")
    let previous = element(app, "sidebar-sync-state").label
    element(app, "sidebar-sync-action").tap()
    waitUntil { self.element(app, "sidebar-sync-state").label == "Sync failed" }
    XCTAssertTrue(element(app, "sidebar-sync-action").label.contains(previous))
    XCTAssertFalse(element(app, "sidebar-sync-last-success").exists)
    XCTAssertTrue(element(app, "sidebar-sync-action").isEnabled)
    assertPillLayout(app)
    attachScreen("git-sync-failure-retains-history")
  }

  private func launchOwnedVault() throws -> XCUIApplication {
    continueAfterFailure = false
    let label = try XCTUnwrap(ProcessInfo.processInfo.environment["MEMORIA_SYNC_QA_LABEL"])
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=native-vault&phoneState=sidebar&qaRun=sidebar-sync-\(UUID().uuidString)"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    addTeardownBlock { app.terminate() }
    app.launch()
    XCTAssertTrue(element(app, "sidebar-sync-action").waitForExistence(timeout: 30))
    XCTAssertEqual(element(app, "sidebar-toolbar-title").label, label, "Only the owned fixture may be used")
    return app
  }

  private func assertPillLayout(_ app: XCUIApplication) {
    let pill = element(app, "sidebar-sync-action")
    let command = element(app, "sidebar-command-palette-action")
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(pill.isHittable)
    XCTAssertGreaterThanOrEqual(pill.frame.height, 44)
    XCTAssertTrue(element(app, "workspace-sidebar-panel").frame.contains(pill.frame))
    XCTAssertLessThanOrEqual(pill.frame.maxX, command.frame.minX)
    XCTAssertLessThanOrEqual(command.frame.maxX, settings.frame.minX)
    let source = element(app, "sidebar-sync-destination")
    let detail = element(app, "sidebar-sync-state")
    XCTAssertLessThanOrEqual(source.frame.height, 24)
    XCTAssertLessThanOrEqual(detail.frame.height, 24)
    XCTAssertLessThanOrEqual(source.frame.maxY, detail.frame.minY + 1)
    XCTAssertFalse(element(app, "sync-status-bar").exists)
  }

  private func waitUntil(_ condition: @escaping () -> Bool) {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
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
