import XCTest
import UIKit

final class MobileEditorResumeTests: XCTestCase {
  func testEditorRecoversAfterBackgroundWebContentTermination() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_QA_EDITOR_PROCESS"] == "1", "Requires an owned process-loss fixture")
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .phone ? .portrait : .landscapeLeft
    let app = openFixture()
    let before = app.webViews.textViews.firstMatch
    XCTAssertTrue(before.waitForExistence(timeout: 15))
    XCTAssertTrue((before.value as? String ?? "").contains("Keep this existing note"))
    XCUIDevice.shared.press(.home)
    let background = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in [.runningBackground, .runningBackgroundSuspended].contains(app.state) }, object: nil)
    wait(for: [background], timeout: 10)
    print("MEMORIA_EDITOR_WEBVIEW_BACKGROUND_READY")
    let resumed = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in app.state == .runningForeground }, object: nil)
    wait(for: [resumed], timeout: 30)
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 15))
    let restored = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in (editor.value as? String ?? "").contains("Keep this existing note") }, object: nil)
    wait(for: [restored], timeout: 10)
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    editor.typeText(" Recovered input")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let text = source.value as? String ?? ""
    XCTAssertTrue(text.contains("Keep this existing note"))
    XCTAssertTrue(text.contains("Recovered input"))
    XCTAssertTrue(text.contains("custom: keep-me"))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  private func openFixture() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    let search = "?source=native&phoneState=list&editorMode=wysiwyg&tabletPanels=all&qaRun=editor-resume"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element(app, "note-list-toolbar").waitForExistence(timeout: 40))
    if UIDevice.current.userInterfaceIdiom == .phone { MobilePanelNavigation.openSidebar(app) }
    let allNotes = element(app, "sidebar-item-all-notes")
    XCTAssertTrue(allNotes.waitForExistence(timeout: 10))
    allNotes.tap()
    let row = element(app, "note-row-selected.md")
    XCTAssertTrue(row.waitForExistence(timeout: 15))
    row.tap()
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
