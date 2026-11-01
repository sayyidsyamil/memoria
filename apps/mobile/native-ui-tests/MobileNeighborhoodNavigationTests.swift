import UIKit
import XCTest

final class MobileNeighborhoodNavigationTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")

  override func tearDown() {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testNeighborhoodShowsReferencesAndOpensTheSelectedNote() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let search = "?source=fixture&scenario=markdown-heavy&selectedNoteId=workflow-orchestration&phoneState=editor&qaRun=neighborhood-navigation"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    let more = element("editor-more-action")
    XCTAssertTrue(more.waitForExistence(timeout: 30))
    more.tap()
    let open = element("workspace-action-open-neighborhood")
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.tap()
    XCTAssertFalse(element("workspace-action-sheet").exists)
    let heading = element("note-list-toolbar-title")
    expect(heading, predicate: "label == 'Workflow Orchestration Essay'")
    XCTAssertTrue(element("relationship-group-referenced-by").waitForExistence(timeout: 5))
    let row = element("note-row-markdown-heavy-renderer")
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertTrue(row.isHittable)
    row.tap()
    expect(element("editor-toolbar-title"), predicate: "label == 'Markdown Renderer Parity.md'")
    let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    capture.name = "neighborhood-reference-selected"
    capture.lifetime = .keepAlways
    add(capture)
  }

  private func expect(_ target: XCUIElement, predicate: String) {
    expectation(for: NSPredicate(format: predicate), evaluatedWith: target)
    waitForExpectations(timeout: 10)
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
