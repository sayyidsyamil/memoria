import XCTest

final class MobilePersistenceIsolationTests: XCTestCase {
  func testDisposableWorkspacePersistence() {
    let app = launchProbe("phoneState=list&workspacePersistenceProbe=1")
    let list = app.descendants(matching: .any).matching(identifier: "note-list-panel").firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 30))
    XCTAssertTrue(list.isHittable)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "workspace-load-failure").firstMatch.exists)
    captureScreen()
  }

  func testRichEditorPersistence() {
    let app = launchProbe("phoneState=editor&editorMode=wysiwyg&wysiwygPersistenceProbe=1&wysiwygMutationProbe=1")
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 30))
    XCTAssertGreaterThan(editor.frame.width, 200, "Persistence QA requires a readable editor surface")
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "workspace-load-failure").firstMatch.exists)
    captureScreen()
  }

  private func launchProbe(_ parameters: String) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&tabletPanels=all&\(parameters)&qaRun=native-persistence-isolation"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    orientTablet(app)
    return app
  }

  private func orientTablet(_ app: XCUIApplication) {
    guard min(app.frame.width, app.frame.height) >= 700 else { return }
    XCUIDevice.shared.orientation = .landscapeLeft
    expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
  }

  private func captureScreen() {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
