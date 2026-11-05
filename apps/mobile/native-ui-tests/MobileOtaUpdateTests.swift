import UIKit
import XCTest

final class MobileOtaUpdateTests: XCTestCase {
  func testOwnedVaultSourceSurvivesNativeUpdateLaunch() {
    let app = openOwnedNote(mode: "source")
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 15))
    XCTAssertTrue((source.value as? String ?? "").contains("Additive owned OTA fixture."))
    XCTAssertTrue((source.value as? String ?? "").contains("type: Note"))
    capture()
  }

  func testSourceBackedRichEditorHydratesOwnedVaultContent() {
    let app = openOwnedNote(mode: "wysiwyg")
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 15))
    XCTAssertTrue((editor.value as? String ?? "").contains("Additive owned OTA fixture."))
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    XCTAssertTrue((source.value as? String ?? "").contains("Additive owned OTA fixture."))
    capture()
  }

  func testExistingOwnedNoteDoesNotTakeKeyboardFocus() {
    let app = openOwnedNote(mode: "wysiwyg")
    XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 15))
    let appeared = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in app.keyboards.firstMatch.exists }, object: nil)
    appeared.isInverted = true
    wait(for: [appeared], timeout: 3)
  }

  func testNewOwnedNoteKeepsHeadingFocusAcrossAutosave() {
    let app = launchOwnedVault(mode: "wysiwyg")
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 10))
    create.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
    app.typeText("Native heading\nNative body retained after save.")
    let lostFocus = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: nil)
    lostFocus.isInverted = true
    wait(for: [lostFocus], timeout: 5)
    app.typeText(" Still focused.")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    let content = source.value as? String ?? ""
    XCTAssertTrue(content.contains("# Native heading"))
    XCTAssertTrue(content.contains("Native body retained after save. Still focused."))
    XCTAssertTrue(content.contains("type: Note"))
    capture()
  }

  private func openOwnedNote(mode: String) -> XCUIApplication {
    let app = launchOwnedVault(mode: mode)
    ownedNote(app).tap()
    return app
  }

  private func launchOwnedVault(mode: String) -> XCUIApplication {
    continueAfterFailure = false
    let tablet = UIDevice.current.userInterfaceIdiom == .pad
    XCUIDevice.shared.orientation = tablet ? .landscapeLeft : .portrait
    let app = XCUIApplication(bundleIdentifier: "md.memoria.mobile.ota-validation")
    let search = "?source=native-vault&phoneState=list&editorMode=\(mode)&qaRun=owned-ota"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    XCTAssertTrue(ownedNote(app).waitForExistence(timeout: 30))
    if tablet {
      XCTAssertGreaterThan(app.frame.width, app.frame.height, "iPad acceptance must run in landscape")
    } else {
      XCTAssertGreaterThan(app.frame.height, app.frame.width, "iPhone acceptance must run in portrait")
    }
    addTeardownBlock { app.terminate() }
    return app
  }

  private func ownedNote(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "OTA retained content")).firstMatch
  }

  private func capture() {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.lifetime = .keepAlways
    add(image)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}
