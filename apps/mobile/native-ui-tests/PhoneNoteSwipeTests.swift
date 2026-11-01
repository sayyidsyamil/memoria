import XCTest

final class PhoneNoteSwipeTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
  }

  func testRowSwipeRevealsActionsWithoutOpeningSidebar() {
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    drag(row, from: 0.75, to: 0.40)
    let archive = element(app, "note-swipe-archive-workflow-orchestration")
    XCTAssertTrue(archive.waitForExistence(timeout: 5))
    XCTAssertTrue(archive.isHittable)
    XCTAssertTrue(element(app, "note-swipe-delete-workflow-orchestration").isHittable)
    XCTAssertFalse(element(app, "phone-sidebar-screen").exists)
    archive.tap()
    verifyArchivedNote(app)
  }

  func testTrailingFavoriteThenFullSwipeArchivePreservesNote() {
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    row.tap()
    let favorite = element(app, "editor-favorite-action")
    XCTAssertTrue(favorite.waitForExistence(timeout: 5))
    let initialLabel = favorite.label
    MobilePanelNavigation.back(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    drag(row, from: 0.75, to: 0.40)
    let swipeFavorite = element(app, "note-swipe-favorite-workflow-orchestration")
    XCTAssertTrue(swipeFavorite.waitForExistence(timeout: 5))
    XCTAssertTrue(swipeFavorite.isHittable)
    swipeFavorite.tap()
    row.tap()
    waitUntil { favorite.exists && favorite.label != initialLabel }
    MobilePanelNavigation.back(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    drag(row, from: 0.92, to: 0.08)
    verifyArchivedNote(app)
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func verifyArchivedNote(_ app: XCUIApplication) {
    let row = element(app, "note-row-workflow-orchestration")
    waitUntil { !row.exists }
    MobilePanelNavigation.openSidebar(app)
    let archive = element(app, "sidebar-item-archive")
    XCTAssertTrue(archive.waitForExistence(timeout: 5))
    archive.tap()
    XCTAssertTrue(row.waitForExistence(timeout: 5))
  }

  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=list&editorMode=wysiwyg&qaRun=phone-row-swipe"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    addTeardownBlock { app.terminate() }
    app.launch()
    return app
  }

  private func drag(_ row: XCUIElement, from: Double, to: Double) {
    row.coordinate(withNormalizedOffset: CGVector(dx: from, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: to, dy: 0.5)))
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitUntil(_ predicate: @escaping () -> Bool) {
    expectation(for: NSPredicate { _, _ in predicate() }, evaluatedWith: nil)
    waitForExpectations(timeout: 8)
  }
}
