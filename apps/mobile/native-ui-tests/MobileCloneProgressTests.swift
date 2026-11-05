import XCTest

// Public read-only clones in a disposable simulator; never pushes to a remote.
final class MobileCloneProgressTests: XCTestCase {
  func testPublicCloneShowsProgressAndCanBeCancelled() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_PUBLIC_CLONE"] == "1", "Requires a disposable simulator")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=sidebar&qaRun=clone-progress"]
    app.launch()
    let open = element(app, "open-mobile-settings")
    if !open.exists { element(app, "note-list-toolbar").swipeRight() }
    XCTAssertTrue(open.waitForExistence(timeout: 30))
    open.tap()
    let manage = element(app, "settings-manage-vaults")
    if !manage.isHittable { element(app, "mobile-settings").swipeUp() }
    manage.tap()
    let url = element(app, "git-repository-url")
    let manager = element(app, "vault-manager")
    for _ in 0..<5 where !url.isHittable { manager.swipeUp() }
    XCTAssertTrue(url.isHittable)
    url.tap()
    url.typeText("https://github.com/isomorphic-git/isomorphic-git")
    let clone = element(app, "clone-git-vault")
    if !clone.isHittable { manager.swipeUp() }
    clone.tap()
    let progress = element(app, "git-clone-progress")
    XCTAssertTrue(progress.waitForExistence(timeout: 10))
    let count = element(app, "git-clone-count")
    XCTAssertTrue(count.waitForExistence(timeout: 60))
    XCTAssertTrue(element(app, "git-clone-cancel").isHittable)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
    element(app, "git-clone-cancel").tap()
    let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !progress.exists }, object: nil)
    wait(for: [stopped], timeout: 60)
    XCTAssertTrue(element(app, "clone-git-vault").isEnabled)
    XCTAssertFalse(app.staticTexts["The operation failed. Your local files have been kept. Check your connection and repository permissions, then retry."].exists)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
