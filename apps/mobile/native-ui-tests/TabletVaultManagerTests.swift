import XCTest
import UIKit

final class TabletVaultManagerTests: XCTestCase {
  func testCancellingFolderPickerReturnsToManager() {
    let app = openManager()
    cancelFolderSelection(app)
    cancelFolderSelection(app)
    app.buttons["Close settings"].firstMatch.tap()
    XCTAssertTrue(element(app, "open-mobile-settings").waitForExistence(timeout: 5))
  }

  func testVaultManagerRestoresCredentialAccessAndRejectsInvalidRepository() {
    let app = openManager()
    let manager = element(app, "vault-manager")
    XCTAssertTrue(manager.waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Could not read or update your saved GitHub sign-in. Please retry."].exists)
    let input = app.textFields.matching(identifier: "git-repository-url").firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    if !input.isHittable { manager.swipeUp() }
    input.tap()
    input.typeText("not a repository")
    XCTAssertFalse(app.buttons.matching(identifier: "clone-git-vault").firstMatch.isEnabled)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
    app.buttons["Close settings"].firstMatch.tap()
    expectation(for: NSPredicate { _, _ in !manager.exists }, evaluatedWith: nil)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(element(app, "open-mobile-settings").exists)
  }

  private func openManager() -> XCUIApplication {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let search = "?source=fixture&phoneState=sidebar&forceDesktopPanels=1&qaRun=vault-manager"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    let openSettings = element(app, "open-mobile-settings")
    XCTAssertTrue(openSettings.waitForExistence(timeout: 30))
    openSettings.tap()
    let settings = element(app, "mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    XCTAssertTrue(element(app, "vault-manager").waitForExistence(timeout: 5))
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func cancelFolderSelection(_ app: XCUIApplication) {
    let open = app.buttons["Open local folder"].firstMatch
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let cancel = app.buttons["Cancel"].firstMatch
    XCTAssertTrue(cancel.waitForExistence(timeout: 10))
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = "System folder picker"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    cancel.tap()
    expectation(for: NSPredicate { _, _ in open.exists && open.isEnabled }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
    XCTAssertTrue(app.buttons["Close settings"].firstMatch.exists)
  }
}
