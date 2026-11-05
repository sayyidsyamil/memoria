import XCTest
import UIKit

// The host adds this note only to disposable simulator vaults.
final class MobileOfflineImageTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testLocalImageLoadsAndKeepsItsPortableReference() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&commandPalette=1&qaRun=offline-image"]
    app.launch()
    let allNotes = element(app, "mobile-command-palette-command-go-all-notes")
    XCTAssertTrue(allNotes.waitForExistence(timeout: 30))
    allNotes.tap()
    let row = element(app, "note-row-codex-native-image-qa.md")
    XCTAssertTrue(row.waitForExistence(timeout: 15))
    row.tap()
    let image = app.webViews.images.matching(identifier: "Native offline image QA").firstMatch
    let visible = image.waitForExistence(timeout: 15)
    XCTAssertTrue(visible)
    expectation(for: NSPredicate { _, _ in image.frame.height > 100 && image.frame.width > 100 }, evaluatedWith: nil)
    waitForExpectations(timeout: 10)
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
    let editor = app.webViews.textViews.firstMatch
    editor.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.05)).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    app.typeText("QA typed ")
    let lostFocus = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostFocus.isInverted = true
    wait(for: [lostFocus], timeout: 8)
    app.typeText("after saving ")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("![Native offline image QA](attachments/"))
    XCTAssertFalse(content.contains("file:///"))
    XCTAssertTrue(content.contains("QA typed after saving"))
    XCTAssertTrue(content.contains("type: Note"))
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }
}
