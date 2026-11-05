import UIKit
import XCTest

final class MobileLargeVaultReadOnlyTests: XCTestCase {
  func testLargeLocalVaultOpensTypesAndNotesWithoutEditing() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_LARGE_VAULT_QA"] == "1",
      "Requires a disposable copy and host-side catalog restoration")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "md.memoria.mobile.ota-validation")
    let search = "?source=native-vault&phoneState=sidebar&editorMode=source&qaRun=large-vault-readonly"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    addTeardownBlock { app.terminate() }
    let started = Date()
    app.launch()
    let sidebar = element(app, "workspace-sidebar-panel")
    XCTAssertTrue(sidebar.waitForExistence(timeout: 40))
    waitForOwnedVault(app)
    let allNotes = element(app, "sidebar-item-all-notes")
    XCTAssertTrue(allNotes.waitForExistence(timeout: 10))
    let count = noteCount(app)
    XCTAssertGreaterThanOrEqual(count, 1000, "The mounted corpus must not be a tiny fixture")
    allNotes.tap()
    let rows = app.descendants(matching: .any).matching(NSPredicate(
      format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "note-row-", ".md"))
    let row = rows.firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    let listReadyMs = Date().timeIntervalSince(started) * 1000
    let noteStarted = Date()
    row.tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 15))
    XCTAssertNotNil(source.value as? String)
    let noteReadyMs = Date().timeIntervalSince(noteStarted) * 1000
    if UIDevice.current.userInterfaceIdiom == .phone { MobilePanelNavigation.back(app) }
    MobilePanelNavigation.openSidebar(app)
    let type = firstVisibleType(app)
    let typeStarted = Date()
    type.tap()
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    let typeReadyMs = Date().timeIntervalSince(typeStarted) * 1000
    row.tap()
    XCTAssertTrue(source.waitForExistence(timeout: 15))
    let report = "{\"noteCount\":\(count),\"listReadyMs\":\(listReadyMs),\"noteReadyMs\":\(noteReadyMs),\"typeReadyMs\":\(typeReadyMs)}"
    let receipt = XCTAttachment(string: report)
    receipt.name = "large-vault-readonly-observations"
    receipt.lifetime = .keepAlways
    add(receipt)
  }

  private func waitForOwnedVault(_ app: XCUIApplication) {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      self.element(app, "sidebar-toolbar-title").label == "Owned Laputa QA"
        && self.noteCount(app) >= 1000
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 40), .completed)
  }

  private func noteCount(_ app: XCUIApplication) -> Int {
    let pill = element(app, "sidebar-item-all-notes-count")
    let text = pill.staticTexts.firstMatch
    return Int((text.exists ? text.label : pill.label).filter(\.isNumber)) ?? 0
  }

  private func firstVisibleType(_ app: XCUIApplication) -> XCUIElement {
    let section = element(app, "sidebar-section-types")
    let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar-item-"))
    for _ in 0..<5 {
      if let row = rows.allElementsBoundByIndex.first(where: { $0.isHittable && section.frame.contains($0.frame) }) {
        return row
      }
      element(app, "sidebar-scroll").swipeUp()
    }
    XCTFail("Expected a visible type inside the Types section")
    return rows.firstMatch
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
