import XCTest

final class MobileStarterVaultTests: XCTestCase {
  func testFreshInstallOpensBundledGuideAndPreservesANewNoteAfterRelaunch() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_FRESH_STARTER"] == "1",
      "Requires a disposable fresh installation")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&commandPalette=1&qaRun=starter-first-launch"]
    app.launch()
    openAllNotes(app)
    let guide = element(app, "note-row-get-familiar-with-memoria.md")
    reveal(guide, in: app)
    guide.tap()
    waitForEditor(app, filename: "get-familiar-with-memoria.md")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    XCTAssertTrue((source.value as? String ?? "").contains("# Get familiar with Memoria"))
    attachScreenshot(app)
    app.terminate()
    app.launch()
    openAllNotes(app)
    element(app, "note-list-create-action").tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
    app.typeText("Starter persistence QA\nAdditive test note.")
    XCUIDevice.shared.press(.home)
    app.terminate()
    app.launch()
    openAllNotes(app)
    let saved = app.descendants(matching: .any).matching(NSPredicate(
      format: "identifier BEGINSWITH %@", "note-row-untitled-note-")).firstMatch
    reveal(saved, in: app)
    let filename = String(saved.identifier.dropFirst("note-row-".count))
    saved.tap()
    waitForEditor(app, filename: filename)
    element(app, "editor-source-action").tap()
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    XCTAssertTrue((source.value as? String ?? "").contains("# Starter persistence QA"))
    XCTAssertTrue((source.value as? String ?? "").contains("Additive test note."))
    attachScreenshot(app)
  }

  private func openAllNotes(_ app: XCUIApplication) {
    let command = element(app, "mobile-command-palette-command-go-all-notes")
    XCTAssertTrue(command.waitForExistence(timeout: 30))
    command.tap()
    MobilePanelNavigation.wait { !self.element(app, "mobile-command-palette").exists }
    expectation(for: NSPredicate(format: "label == %@", "All Notes"),
      evaluatedWith: element(app, "note-list-toolbar-title"))
    waitForExpectations(timeout: 10)
  }

  private func waitForEditor(_ app: XCUIApplication, filename: String) {
    MobilePanelNavigation.wait { self.element(app, "editor-toolbar-title").label == filename }
    let stage = element(app, "phone-transition-stage")
    if stage.exists {
      let editor = element(app, "editor-panel")
      MobilePanelNavigation.wait {
        abs(editor.frame.minX - stage.frame.minX) < 1 && abs(editor.frame.width - stage.frame.width) < 1
      }
    }
  }

  private func reveal(_ row: XCUIElement, in app: XCUIApplication) {
    let list = element(app, "note-list-panel")
    for _ in 0..<12 {
      if row.exists && row.isHittable { return }
      list.swipeUp()
    }
    XCTAssertTrue(row.isHittable)
  }

  private func attachScreenshot(_ app: XCUIApplication) {
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
