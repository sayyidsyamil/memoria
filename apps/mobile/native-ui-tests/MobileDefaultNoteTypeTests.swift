import XCTest

final class MobileDefaultNoteTypeTests: XCTestCase {
  func testNewNotePersistsWithItsDefaultTypeAcrossRelaunch() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_DEFAULT_NOTE_TYPE"] == "1",
      "Requires an empty disposable native vault; never run against user data")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&phoneState=list&qaRun=default-note-type"]
    app.launch()
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    app.typeText("Default type QA\nNative saved body.")
    element(app, "editor-source-action").tap()
    verifySource(app)
    XCUIDevice.shared.press(.home)
    let saved = expectation(description: "Allow the bounded background flush")
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saved.fulfill() }
    wait(for: [saved], timeout: 5)
    app.terminate()
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&editorMode=source&qaRun=default-note-reload"]
    app.launch()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Default type QA")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    row.tap()
    verifySource(app)
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func verifySource(_ app: XCUIApplication) {
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("type: Note"))
    XCTAssertTrue(content.contains("# Default type QA"))
    XCTAssertTrue(content.contains("Native saved body."))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
