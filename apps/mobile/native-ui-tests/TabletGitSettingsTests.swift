import XCTest

final class TabletGitSettingsTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testSettingsHaveNativeSpacingAndPersistAutoGit() {
    let app = launchVault()
    openSettings(app)
    let toggle = element(app, "settings-auto-git")
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    XCTAssertTrue(toggle.isEnabled)
    XCTAssertEqual(toggle.frame.width, 44, accuracy: 1)
    XCTAssertEqual(toggle.frame.height, 26, accuracy: 1)
    toggle.tap()
    XCTAssertEqual(toggle.value as? String, "1")
    app.terminate()
    app.launch()
    openSettings(app)
    let restored = element(app, "settings-auto-git")
    XCTAssertTrue(restored.waitForExistence(timeout: 5))
    XCTAssertEqual(restored.value as? String, "1")
    restored.tap()
    XCTAssertEqual(restored.value as? String, "0")
    record(app, "settings")
  }

  func testManualSyncRequiresCommitAndAcceptsUserMessage() {
    let app = launchVault()
    let sync = element(app, "vault-sync-retry")
    XCTAssertTrue(sync.waitForExistence(timeout: 30))
    sync.tap()
    XCTAssertTrue(app.staticTexts["Commit your local changes before syncing in manual mode."].waitForExistence(timeout: 15))
    let message = element(app, "git-commit-message")
    XCTAssertTrue(message.exists)
    XCTAssertGreaterThanOrEqual(message.frame.height, 40)
    message.tap()
    message.typeText("iPad manual commit QA")
    let commit = element(app, "git-commit-local")
    XCTAssertTrue(commit.isEnabled)
    commit.tap()
    XCTAssertTrue(app.staticTexts["Committed locally"].firstMatch.waitForExistence(timeout: 15))
    record(app, "local-commit")
  }

  private func launchVault() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native&editorMode=wysiwyg&qaRun=git-settings"]
    app.launch()
    return app
  }

  private func openSettings(_ app: XCUIApplication) {
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func record(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
