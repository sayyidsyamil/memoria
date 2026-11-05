import XCTest
import UIKit

final class MobileFilenameHeaderTests: XCTestCase {
  func testBreadcrumbShowsLiteralFilenameWithoutChangingHeading() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.terminate()
    XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
    let search = "?source=fixture&phoneState=editor&forceDesktopPanels=1&qaRun=filename-header"
    app.launchArguments = ["--memoria-mobile-search", search]
    app.launchEnvironment["MEMORIA_MOBILE_SEARCH"] = search
    app.launch()
    let title = app.staticTexts.matching(identifier: "editor-toolbar-title").firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 30))
    XCTAssertEqual(title.label, "Workflow Orchestration Essay.md")
    XCTAssertFalse(title.label.contains("/"))
    let heading = app.webViews.staticTexts["Workflow Orchestration Essay"].firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 10))
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = "Literal filename breadcrumb"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
