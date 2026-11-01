import XCTest

// Live integration check: requires the configured public OAuth client and network.
final class TabletGitHubControlsTests: XCTestCase {
  func testDeviceAuthorizationCodeCopiesWithoutOpeningTheBrowser() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native&qaRun=github-code"]
    app.launch()
    let vaults = app.buttons["Manage vaults"]
    XCTAssertTrue(vaults.waitForExistence(timeout: 30))
    vaults.tap()
    let signIn = app.buttons["Sign in with GitHub"]
    XCTAssertTrue(signIn.waitForExistence(timeout: 5))
    XCTAssertTrue(signIn.isEnabled)
    signIn.tap()
    let copy = element(app, "github-copy-device-code")
    XCTAssertTrue(copy.waitForExistence(timeout: 20))
    copy.tap()
    let copied = NSPredicate(format: "label == %@", "Code copied")
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: copied, object: copy)], timeout: 5), .completed)
    XCTAssertEqual(app.state, .runningForeground)
    app.buttons["Cancel"].firstMatch.tap()
    app.buttons["Close"].firstMatch.tap()
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
