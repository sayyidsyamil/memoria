import UIKit
import XCTest

final class MobilePendingSyncPillTests: XCTestCase {
  func testPendingMarkerSharesTheSourceLine() {
    let app = launchOwnedGitVault()
    let source = element(app, "sidebar-sync-destination")
    let detail = element(app, "sidebar-sync-state")
    let marker = element(app, "sidebar-sync-pending-local")
    XCTAssertTrue(marker.exists)
    XCTAssertLessThanOrEqual(source.frame.height, 24)
    XCTAssertLessThanOrEqual(detail.frame.height, 24)
    XCTAssertGreaterThanOrEqual(marker.frame.minX, source.frame.maxX)
    XCTAssertLessThanOrEqual(abs(marker.frame.midY - source.frame.midY), 2)
    XCTAssertEqual(marker.frame.width, 8, accuracy: 1)
    XCTAssertEqual(marker.frame.height, 8, accuracy: 1)
    XCTAssertLessThanOrEqual(source.frame.maxY, detail.frame.minY + 1)
    XCTAssertFalse(element(app, "sidebar-sync-last-success").exists)
    capture()
  }

  func testManualPendingSyncOpensCommitControls() {
    let app = launchOwnedGitVault()
    let pill = element(app, "sidebar-sync-action")
    XCTAssertTrue(pill.isEnabled)
    XCTAssertTrue(pill.label.contains("Changes pending"))
    pill.tap()
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 10))
    capture()
  }

  private func launchOwnedGitVault() -> XCUIApplication {
    continueAfterFailure = false
    let tablet = UIDevice.current.userInterfaceIdiom == .pad
    XCUIDevice.shared.orientation = tablet ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "md.memoria.mobile.ota-validation")
    let search = "?source=native-vault&phoneState=sidebar&qaRun=owned-pending-sync"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    addTeardownBlock { app.terminate() }
    app.launch()
    XCTAssertTrue(element(app, "sidebar-sync-action").waitForExistence(timeout: 30))
    XCTAssertEqual(element(app, "sidebar-toolbar-title").label, "OTA validation")
    XCTAssertEqual(element(app, "sidebar-sync-destination").label, "GitHub")
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func capture() {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.lifetime = .keepAlways
    add(image)
  }
}
