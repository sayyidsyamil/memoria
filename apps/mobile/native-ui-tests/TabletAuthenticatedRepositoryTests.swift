import XCTest

// Opt-in integration acceptance for the owner's authorized simulator session.
// Clones only; never commits, changes AutoGit, or pushes to the real repository.
final class TabletAuthenticatedRepositoryTests: XCTestCase {
  func testAuthenticatedPickerAndLaputaClone() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_AUTHENTICATED_CLONE"] == "1", "Requires explicit read-only clone authorization and an existing GitHub session")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&qaRun=authenticated-repository"]
    app.launch()
    let vaults = element(app, "open-mobile-settings")
    XCTAssertTrue(vaults.waitForExistence(timeout: 60))
    vaults.tap()
    let manage = element(app, "settings-manage-vaults")
    if !manage.isHittable { element(app, "mobile-settings").swipeUp() }
    manage.tap()
    let load = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Load repositories")).firstMatch
    XCTAssertTrue(load.waitForExistence(timeout: 30), "Requires the already authorized GitHub session")
    load.tap()
    let search = element(app, "github-repository-search")
    XCTAssertTrue(search.waitForExistence(timeout: 10))
    search.tap()
    search.typeText("refactoringhq/laputa")
    let repository = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "refactoringhq/laputa,")).firstMatch
    XCTAssertTrue(repository.waitForExistence(timeout: 30))
    XCTAssertGreaterThanOrEqual(repository.frame.height, 64)
    XCTAssertGreaterThan(repository.frame.width, 300)
    capture()
    repository.tap()
    XCTAssertTrue(app.staticTexts["Cloning repository..."].waitForExistence(timeout: 10))
    let cloned = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "select-vault-", "laputa")).firstMatch
    XCTAssertTrue(cloned.waitForExistence(timeout: 600))
    capture()
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func capture() {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.lifetime = .keepAlways
    add(image)
  }
}
