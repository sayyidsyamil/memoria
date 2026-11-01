import UIKit
import XCTest

final class MobileUpdateDiagnosticsTests: XCTestCase {
  func testNativeBuildAndUpdateIdentityRemainReachableAfterRotation() {
    continueAfterFailure = false
    let tablet = UIDevice.current.userInterfaceIdiom == .pad
    XCUIDevice.shared.orientation = tablet ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=sidebar&forceDesktopPanels=1&qaRun=update-diagnostics"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    addTeardownBlock { app.terminate() }
    let open = element(app, "open-mobile-settings")
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let settings = element(app, "mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    verifyDiagnostics(app, settings: settings)
    XCUIDevice.shared.orientation = tablet ? .portrait : .landscapeLeft
    verifyDiagnostics(app, settings: settings)
    app.buttons["Close settings"].firstMatch.tap()
    XCTAssertTrue(settings.waitForNonExistence(timeout: 15))
  }

  private func verifyDiagnostics(_ app: XCUIApplication, settings: XCUIElement) {
    let scroll = settings.scrollViews.firstMatch
    for id in ["settings-update-build", "settings-update-running", "settings-update-runtime", "settings-update-status", "settings-update-apply"] {
      let item = element(app, id)
      XCTAssertTrue(item.waitForExistence(timeout: 5), id)
      for _ in 0..<16 where !scroll.frame.contains(item.frame) { reveal(item, in: settings) }
      XCTAssertTrue(scroll.frame.contains(item.frame), id)
      if id == "settings-update-apply" { XCTAssertTrue(item.isHittable, id) }
      XCTAssertGreaterThanOrEqual(item.frame.minX, settings.frame.minX)
      XCTAssertLessThanOrEqual(item.frame.maxX, settings.frame.maxX + 1)
    }
    let build = element(app, "settings-update-build").label
    XCTAssertNotNil(build.range(of: "^App [0-9]+\\.[0-9]+\\.[0-9]+ \\(build [0-9]+\\)$", options: .regularExpression))
    XCTAssertFalse(element(app, "settings-update-status").label.contains("Up to date"))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func reveal(_ item: XCUIElement, in settings: XCUIElement) {
    let scroll = settings.scrollViews.firstMatch
    let movingDown = item.frame.midY > scroll.frame.midY
    let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: movingDown ? 0.7 : 0.4))
    let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: movingDown ? 0.4 : 0.7))
    start.press(forDuration: 0.01, thenDragTo: end)
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
