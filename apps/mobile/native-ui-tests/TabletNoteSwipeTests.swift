import UIKit
import XCTest

final class TabletNoteSwipeTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testPartialSwipeRevealsActionsWithoutMovingPanels() {
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    let before = row.frame
    drag(row, from: 0.82, to: 0.25)
    let archive = element(app, "note-swipe-archive-workflow-orchestration")
    XCTAssertTrue(archive.waitForExistence(timeout: 5))
    XCTAssertTrue(archive.isHittable)
    assertTrailingActionOrder(app)
    XCTAssertEqual(element(app, "note-list-panel").frame.minX, before.minX, accuracy: 1)
    XCTAssertTrue(element(app, "sidebar-item-all-notes").isHittable)
    archive.tap()
    waitUntil { !row.exists }
    element(app, "sidebar-item-archive").tap()
    XCTAssertTrue(row.waitForExistence(timeout: 5))
  }

  func testFullSwipeArchivesAndFavoriteTogglesWithoutDeleting() {
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    let favorite = element(app, "editor-favorite-action")
    let initialLabel = favorite.label
    drag(row, from: 0.82, to: 0.25)
    assertTrailingActionOrder(app)
    element(app, "note-swipe-favorite-workflow-orchestration").tap()
    waitUntil { favorite.label != initialLabel }
    drag(row, from: 0.92, to: 0.08)
    waitUntil { !row.exists }
    element(app, "sidebar-item-archive").tap()
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    let image = XCTAttachment(screenshot: app.screenshot())
    image.lifetime = .keepAlways
    add(image)
  }

  func testPhoneRightSwipeOpensSidebarWithoutFavoriting() throws {
    try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "Phone navigation gesture")
    XCUIDevice.shared.orientation = .portrait
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    drag(row, from: 0.15, to: 0.85)
    let allNotes = element(app, "sidebar-item-all-notes")
    waitUntil { allNotes.isHittable }
    allNotes.tap()
    waitUntil { row.isHittable }
    drag(row, from: 0.75, to: 0.30)
    assertTrailingActionOrder(app)
    element(app, "note-swipe-favorite-workflow-orchestration").tap()
    row.tap()
    waitUntil { self.element(app, "editor-favorite-action").label == "Add to Favorites" }
  }

  func testPhoneFullSwipeArchivesWithoutDeleting() throws {
    try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "Phone navigation gesture")
    XCUIDevice.shared.orientation = .portrait
    let app = launchFixture()
    let row = element(app, "note-row-workflow-orchestration")
    XCTAssertTrue(row.waitForExistence(timeout: 30))
    drag(row, from: 0.92, to: 0.08)
    waitUntil { !row.exists }
    let list = element(app, "note-list-panel")
    drag(list, from: 0.15, to: 0.85)
    let archive = element(app, "sidebar-item-archive")
    waitUntil { archive.isHittable }
    archive.tap()
    waitUntil { row.isHittable }
  }

  private func assertTrailingActionOrder(_ app: XCUIApplication) {
    let star = element(app, "note-swipe-favorite-workflow-orchestration")
    let delete = element(app, "note-swipe-delete-workflow-orchestration")
    let archive = element(app, "note-swipe-archive-workflow-orchestration")
    waitUntil { star.isHittable && delete.isHittable && archive.isHittable }
    XCTAssertLessThan(star.frame.maxX, delete.frame.maxX)
    XCTAssertLessThan(delete.frame.maxX, archive.frame.maxX)
  }

  private func launchFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=fixture&phoneState=list&editorMode=wysiwyg&qaRun=row-swipe-\(UUID().uuidString)"
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
