import XCTest

final class MobileSnapshotCacheTests: XCTestCase {
  func testFreshOrCachedStartupReadsTheExpectedSource() throws {
    let app = try launchOwnedVault(mode: "source")
    defer { app.terminate() }
    let expected = try XCTUnwrap(ProcessInfo.processInfo.environment["MEMORIA_QA_SNAPSHOT_TITLE"])
    let row = element(app, "note-row-target.md")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    let button = row.buttons.matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch
    XCTAssertTrue(button.waitForExistence(timeout: 5))
    button.tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let text = source.value as? String ?? ""
    XCTAssertTrue(text.contains("# " + expected))
    XCTAssertTrue(text.contains("custom: preserved"))
    let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    capture.lifetime = .keepAlways
    add(capture)
  }

  func testCachedStartupCreationKeepsKeyboardAndSavesTheDocument() throws {
    let app = try launchOwnedVault(mode: "wysiwyg")
    defer { app.terminate() }
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    app.typeText("Cached startup new note\nNative cached body.")
    let lostKeyboard = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostKeyboard.isInverted = true
    wait(for: [lostKeyboard], timeout: 5)
    app.typeText(" After pause.")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    let text = source.value as? String ?? ""
    XCTAssertTrue(text.contains("type: Note"))
    XCTAssertTrue(text.contains("# Cached startup new note"))
    XCTAssertTrue(text.contains("Native cached body. After pause."))
    XCUIDevice.shared.press(.home)
    let settled = expectation(description: "Bounded native background save")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { settled.fulfill() }
    wait(for: [settled], timeout: 4)
  }

  private func launchOwnedVault(mode: String) throws -> XCUIApplication {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_SNAPSHOT_CACHE"] == "1",
      "Requires a host-owned disposable vault and catalog restoration")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    dismissOldProbePrompt()
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&phoneState=list&editorMode=\(mode)&qaRun=snapshot-cache"]
    app.launch()
    return app
  }

  private func dismissOldProbePrompt() {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let alert = springboard.alerts.matching(NSPredicate(format: "label CONTAINS %@", "Memoria")).firstMatch
    guard alert.exists else { return }
    guard ["Open", "Cancel"].allSatisfy({ alert.buttons[$0].exists }) else { return }
    alert.buttons["Cancel"].tap()
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
