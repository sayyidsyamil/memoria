import XCTest

final class TabletNoteActionGroupTests: XCTestCase {
  func testGroupedActionsAndTouchTargets() {
    continueAfterFailure = false
    let app = launchFixture()
    element(app, "editor-more-action").tap()
    let note = element(app, "workspace-action-group-note")
    XCTAssertTrue(note.waitForExistence(timeout: 5))
    XCTAssertTrue(element(app, "workspace-action-archive-note").isHittable)
    XCTAssertFalse(element(app, "workspace-action-rename-file").exists)
    element(app, "workspace-action-group-edit").tap()
    XCTAssertTrue(element(app, "workspace-action-find-in-note").isHittable)
    XCTAssertFalse(element(app, "workspace-action-delete-note").exists)
    let file = element(app, "workspace-action-group-file")
    file.tap()
    XCTAssertTrue(element(app, "workspace-action-rename-file").isHittable)
    let copy = element(app, "workspace-action-copy-file-path")
    XCTAssertTrue(copy.isHittable)
    XCTAssertGreaterThanOrEqual(copy.frame.height, 44)
    XCTAssertGreaterThanOrEqual(file.frame.height, 44)
    XCTAssertLessThan(file.frame.maxY, copy.frame.minY)
    note.tap()
    XCTAssertTrue(element(app, "workspace-action-archive-note").isHittable)
    let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    capture.lifetime = .keepAlways
    add(capture)
  }

  func testTabletOutlineIsDirectlyAvailable() {
    continueAfterFailure = false
    let app = launchFixture()
    let outline = element(app, "editor-table-of-contents-action")
    XCTAssertTrue(outline.waitForExistence(timeout: 5))
    outline.tap()
    XCTAssertTrue(element(app, "workspace-action-sheet-tableOfContents").waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "workspace-action-group-note").exists)
  }

  func testUndoRemainsAvailableInEditGroup() {
    continueAfterFailure = false
    let app = launchFixture()
    if element(app, "phone-editor-screen").exists { MobilePanelNavigation.back(app) }
    let row = element(app, "note-row-open-source-project")
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    row.tap()
    element(app, "editor-more-action").tap()
    let favorite = element(app, "workspace-action-toggle-favorite")
    XCTAssertTrue(favorite.waitForExistence(timeout: 5))
    let initialLabel = favorite.label
    favorite.tap()
    element(app, "editor-more-action").tap()
    expectation(for: NSPredicate { _, _ in favorite.label != initialLabel }, evaluatedWith: nil)
    waitForExpectations(timeout: 5)
    element(app, "workspace-action-group-edit").tap()
    let undo = element(app, "workspace-action-undo-edit")
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    undo.tap()
    element(app, "editor-more-action").tap()
    expectation(for: NSPredicate { _, _ in favorite.label == initialLabel }, evaluatedWith: nil)
    waitForExpectations(timeout: 5)
  }

  private func launchFixture() -> XCUIApplication {
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&phoneState=editor&editorMode=wysiwyg&qaRun=xctest"]
    app.launch()
    XCTAssertTrue(element(app, "editor-more-action").waitForExistence(timeout: 60))
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
