import UIKit
import XCTest

final class MobileStartupVaultTests: XCTestCase {
  func testWarmVaultOpensAndPreservesFrontmatterAfterEditing() {
    continueAfterFailure = false
    guard let marker = ProcessInfo.processInfo.environment["MEMORIA_STARTUP_QA_MARKER"] else {
      XCTFail("An owned startup fixture is required before any vault interaction")
      return
    }
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native-vault&qaRun=startup-edit"]
    app.launch()
    let rows = NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "note-row-notes/", ".md")
    let row = app.descendants(matching: .any).matching(rows).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 40))
    row.tap()
    element(app, "editor-source-action").tap()
    let original = element(app, "editor-markdown-input")
    XCTAssertTrue(original.waitForExistence(timeout: 10))
    XCTAssertTrue((original.value as? String ?? "").contains("qa_marker: \(marker)"))
    element(app, "editor-source-action").tap()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 15))
    let visible = (editor.value as? String ?? "") + editor.label
    XCTAssertTrue(visible.contains(marker))
    editor.tap()
    app.typeText(" Native startup QA edit.")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("Native startup QA edit."))
    XCTAssertTrue(content.contains("custom: keep"))
    XCTAssertTrue(content.contains("type: Note"))
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "native-startup-edit-source"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
