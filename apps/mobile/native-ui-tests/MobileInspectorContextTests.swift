import XCTest
import UIKit

final class MobileInspectorContextTests: XCTestCase {
  private var phone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testInspectorIdentifiesTheSelectedFileWithoutAddingAnotherHeader() {
    for _ in 0..<3 { verifyNoteChangeFromInspector() }
  }

  func testSourceInspectorIdentifiesTheSelectedFileWithoutAddingAnotherHeader() {
    for _ in 0..<3 { verifyNoteChangeFromInspector(source: true) }
  }

  private func verifyNoteChangeFromInspector(source: Bool = false) {
    let app = launch(source: source)
    let first = openInspector(app)
    if phone {
      MobilePanelNavigation.back(app)
      MobilePanelNavigation.back(app)
    }
    let other = element(app, "note-row-open-source-project")
    XCTAssertTrue(other.waitForExistence(timeout: 5))
    other.tap()
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let title = self.element(app, "editor-toolbar-title")
      return title.exists && title.label != first
    }, object: nil)
    let result = XCTWaiter.wait(for: [changed], timeout: 10)
    if result != .completed { capture("note-selection-did-not-open-editor") }
    XCTAssertEqual(result, .completed, "One tap must select the note and open the editor")
    let second = openInspector(app)
    XCTAssertNotEqual(first, second)
    capture("inspector-context-after-note-change")
  }

  func testInspectorContextSurvivesRotation() {
    let app = launch()
    let filename = openInspector(app)
    XCUIDevice.shared.orientation = phone ? .landscapeLeft : .portrait
    let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      (app.frame.width > app.frame.height) == self.phone
    }, object: nil)
    wait(for: [rotated], timeout: 10)
    assertHeader(app, filename: filename)
    capture("inspector-context-after-rotation")
  }

  private func launch(source: Bool = false) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = phone ? .portrait : .landscapeLeft
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let diagnostics = ProcessInfo.processInfo.environment["MEMORIA_QA_GESTURE_TRACE_URL"]
      .map { "&layoutProbe=1&metricSink=\($0)" } ?? ""
    let mode = source ? "source" : "wysiwyg"
    let search = "?source=fixture&phoneState=editor&tabletPanels=all&forceDesktopPanels=1&qaRun=inspector-context&editorMode=\(mode)" + diagnostics
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar-title").waitForExistence(timeout: 30))
    if source { XCTAssertTrue(element(app, "editor-markdown-input").waitForExistence(timeout: 10)) }
    return app
  }

  private func openInspector(_ app: XCUIApplication) -> String {
    let filename = element(app, "editor-toolbar-title").label
    XCTAssertTrue(filename.hasSuffix(".md"))
    if phone {
      MobilePanelNavigation.openProperties(app)
    } else if !element(app, "properties-panel").exists {
      MobilePanelNavigation.toggleProperties(app)
    }
    assertHeader(app, filename: filename)
    return filename
  }

  private func assertHeader(_ app: XCUIApplication, filename: String) {
    if phone {
      let bar = element(app, "phone-top-bar")
      XCTAssertTrue(bar.waitForExistence(timeout: 5))
      let title = app.staticTexts[filename].firstMatch
      XCTAssertTrue(title.waitForExistence(timeout: 5), "The inspector must retain the exact filename, including extension")
      XCTAssertTrue(bar.frame.contains(title.frame), "The filename must remain inside the single inspector header")
      XCTAssertEqual(bar.frame.height, 44, accuracy: 1, "Note context must not add another header row")
      XCTAssertFalse(element(app, "properties-toolbar").exists)
    } else {
      let title = element(app, "properties-toolbar-title")
      XCTAssertTrue(title.waitForExistence(timeout: 5))
      XCTAssertEqual(title.label, "Properties")
      XCTAssertFalse(element(app, "phone-top-bar").exists)
    }
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    MobilePanelNavigation.element(app, id)
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
