import XCTest
import UIKit

// The host stages these binaries only in disposable simulator vaults.
final class MobileFilePreviewTests: XCTestCase {
  override func tearDown() {
    XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev").terminate()
    XCUIDevice.shared.orientation = .portrait
    super.tearDown()
  }

  func testStandaloneImageRendersAndSurvivesRotation() {
    let app = openFile("codex-native-preview-qa.png")
    let image = element(app, "file-preview-image")
    XCTAssertTrue(image.waitForExistence(timeout: 15))
    XCTAssertTrue(element(app, "file-preview-loading").waitForNonExistence(timeout: 15))
    XCTAssertGreaterThan(image.frame.width, 150)
    XCTAssertGreaterThan(image.frame.height, 150)
    assertImageFits(app, image)
    capture()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .portrait : .landscapeLeft
    XCTAssertTrue(image.waitForExistence(timeout: 5))
    XCTAssertFalse(element(app, "file-preview-fallback").exists)
    assertImageFits(app, image)
    capture()
  }

  func testLocalPdfRendersAndScrollsToSecondPage() {
    let app = openFile("codex-native-preview-qa.pdf")
    let preview = element(app, "file-pdf-preview")
    XCTAssertTrue(preview.waitForExistence(timeout: 15))
    XCTAssertTrue(element(app, "file-preview-loading").waitForNonExistence(timeout: 15))
    XCTAssertFalse(element(app, "file-preview-fallback").exists)
    capture()
    preview.swipeUp()
    capture()
  }

  func testSpreadsheetAllowsOnlyRawEditingAndPreservesSourceOnModeChanges() {
    let app = openFile("codex-native-sheet-qa.md")
    let fallback = element(app, "spreadsheet-unsupported")
    XCTAssertTrue(fallback.waitForExistence(timeout: 15))
    XCTAssertFalse(element(app, "editor-formatting-toolbar").exists)
    XCTAssertFalse(app.webViews.textViews.firstMatch.exists)
    capture()
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let original = source.value as? String
    XCTAssertTrue(original?.contains("_display: sheet") == true)
    XCTAssertTrue(original?.contains("Total,=SUM(B1:B2)") == true)
    element(app, "editor-source-action").tap()
    XCTAssertTrue(fallback.waitForExistence(timeout: 5))
    element(app, "editor-source-action").tap()
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertEqual(source.value as? String, original)
    capture()
  }

  private func openFile(_ filename: String) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search",
      "?source=native-vault&phoneState=list&commandPalette=1&qaRun=file-preview"]
    app.launch()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let search = element(app, "mobile-command-palette-command-file-quick-open")
    XCTAssertTrue(search.waitForExistence(timeout: 30))
    search.tap()
    let input = element(app, "workspace-search-input")
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    input.typeText(filename)
    let result = element(app, "workspace-search-result-\(filename)")
    XCTAssertTrue(result.waitForExistence(timeout: 10))
    result.tap()
    return app
  }

  private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: id).firstMatch
  }

  private func assertImageFits(_ app: XCUIApplication, _ image: XCUIElement) {
    let viewport = element(app, "file-image-preview").frame
    XCTAssertEqual(image.frame.minY, viewport.minY, accuracy: 2)
    XCTAssertEqual(image.frame.maxY, viewport.maxY, accuracy: 2)
    XCTAssertEqual(image.frame.width, viewport.width, accuracy: 2)
  }

  private func capture() {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
