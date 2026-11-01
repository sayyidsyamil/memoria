import XCTest

final class PhonePanelContinuityTests: XCTestCase {
  func testCancelledEditorDragKeepsKeyboardAndDraft() {
    let app = launch("fixture")
    let create = element(app, "note-list-create-action")
    XCTAssertTrue(create.waitForExistence(timeout: 30))
    create.tap()
    let editor = app.webViews.textViews.firstMatch
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    editor.typeText("Continuity draft")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let screen = element(app, "phone-editor-screen")
    drag(screen, from: 0.02, to: 0.10)
    XCTAssertTrue(screen.exists)
    XCTAssertTrue(app.keyboards.firstMatch.exists)
    editor.typeText(" after gesture")
    element(app, "editor-source-action").tap()
    let source = element(app, "editor-markdown-input")
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue((source.value as? String ?? "").contains("Continuity draft after gesture"))
    capture()
  }

  func testLongNoteListKeepsItsScrollPositionAcrossSidebarAndEditor() throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["MEMORIA_RAIL_OWNED_VAULT"] == "1", "Requires the owned long-list fixture")
    let app = launch("native-vault")
    let list = element(app, "note-list-panel")
    XCTAssertTrue(list.waitForExistence(timeout: 30))
    list.swipeUp()
    list.swipeUp()
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "note-row-"))
    let visible = rows.allElementsBoundByIndex.first {
      $0.isHittable && $0.frame.minY > list.frame.minY + 80 && $0.frame.maxY < list.frame.maxY - 100
    }
    let anchor = try XCTUnwrap(visible)
    XCTAssertTrue(anchor.buttons.firstMatch.label.contains("Continuity"))
    let identifier = anchor.identifier
    let position = anchor.frame.minY
    MobilePanelNavigation.openSidebar(app)
    drag(element(app, "phone-sidebar-screen"), from: 0.7, to: 0.1)
    assertPosition(element(app, identifier), y: position)
    element(app, identifier).tap()
    XCTAssertTrue(element(app, "phone-editor-screen").waitForExistence(timeout: 10))
    MobilePanelNavigation.back(app)
    assertPosition(element(app, identifier), y: position)
    capture()
  }

  private func launch(_ source: String) -> XCUIApplication {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    let search = "?source=\(source)&phoneState=list&editorMode=wysiwyg&qaRun=phone-rail-continuity"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    addTeardownBlock { app.terminate() }
    return app
  }

  private func assertPosition(_ row: XCUIElement, y: CGFloat) {
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertTrue(row.isHittable)
    XCTAssertEqual(row.frame.minY, y, accuracy: 1)
  }

  private func drag(_ panel: XCUIElement, from: Double, to: Double) {
    panel.coordinate(withNormalizedOffset: CGVector(dx: from, dy: 0.25))
      .press(forDuration: 0.05, thenDragTo: panel.coordinate(withNormalizedOffset: CGVector(dx: to, dy: 0.25)),
             withVelocity: XCUIGestureVelocity(rawValue: 250), thenHoldForDuration: 0.3)
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
