import XCTest
import UIKit

// The host adds and removes this fixture only in disposable simulator vaults.
final class MobileDiagramPreviewTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testOfflineDiagramsRenderAndKeepOriginalSource() {
    let app = openFixture()
    let mermaid = app.webViews.images["mermaid"].firstMatch
    XCTAssertTrue(mermaid.waitForExistence(timeout: 30))
    XCTAssertGreaterThan(mermaid.frame.width, 100)
    capture()
    XCTAssertFalse(app.webViews.images["tldraw"].exists)
    capture()
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let original = source.value as? String
    XCTAssertTrue(original?.contains("qa: preserve-me") == true)
    XCTAssertTrue(original?.contains("```mermaid") == true)
    XCTAssertTrue(original?.contains("```tldraw id=\"native-qa\" height=\"520\"") == true)
    XCTAssertFalse(original?.contains("blob:") == true)
    element(app, "editor-source-action").tap()
    XCTAssertTrue(mermaid.waitForExistence(timeout: 30))
    element(app, "editor-source-action").tap()
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    XCTAssertEqual(source.value as? String, original)
    capture()
    element(app, "editor-source-action").tap()
    assertEditorRetainsFocus(app)
  }

  private func assertEditorRetainsFocus(_ app: XCUIApplication) {
    let text = app.webViews.textViews.firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 10))
    text.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.03)).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    app.typeText(" QA")
    let lostKeyboard = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostKeyboard.isInverted = true
    wait(for: [lostKeyboard], timeout: 5)
    app.typeText(" focused")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("qa: preserve-me"))
    XCTAssertTrue(content.contains("```mermaid"))
    XCTAssertTrue(content.contains("```tldraw id=\"native-qa\""))
    XCTAssertTrue(content.contains("focused"))
  }

  private func openFixture() -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&commandPalette=1&qaRun=diagram-preview"]
    app.launch()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let command = element(app, "mobile-command-palette-command-file-quick-open")
    XCTAssertTrue(command.waitForExistence(timeout: 30))
    command.tap()
    let input = element(app, "workspace-search-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    input.typeText("codex-native-diagram-qa.md")
    let result = element(app, "workspace-search-result-codex-native-diagram-qa.md")
    XCTAssertTrue(result.waitForExistence(timeout: 10))
    result.tap()
    return app
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func capture() {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
