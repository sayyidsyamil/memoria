import XCTest
import UIKit

final class TabletAppearanceTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
  }

  func testDesktopColorsReachNativePanelsAndRichEditorAndPersist() {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=native&editorMode=wysiwyg&qaRun=appearance"]
    app.launch()
    let title = element(app, "editor-toolbar-title")
    XCTAssertTrue(title.waitForExistence(timeout: 30))
    let originalTitle = title.label
    selectTheme(app, "dark")
    assertDarkSurfaces(app)
    XCTAssertEqual(title.label, originalTitle)
    app.terminate()
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar-title").waitForExistence(timeout: 30))
    assertDarkSurfaces(app)
    selectTheme(app, "light")
    assertSurface(app, x: 30, expected: [247, 246, 243])
    selectTheme(app, "system")
  }

  func testDarkInspectorDialogsAndSourceEditor() {
    let app = XCUIApplication(bundleIdentifier: "com.memoria.mobile.dev")
    app.launchArguments = ["--memoria-mobile-search", "?source=fixture&editorMode=wysiwyg&qaRun=dark-surfaces"]
    app.launch()
    XCTAssertTrue(element(app, "editor-toolbar-title").waitForExistence(timeout: 30))
    selectTheme(app, "dark")
    MobilePanelNavigation.toggleProperties(app)
    let add = element(app, "relationship-add-belongs-to")
    XCTAssertTrue(add.waitForExistence(timeout: 5))
    record("dark-inspector")
    add.tap()
    XCTAssertTrue(element(app, "workspace-relationship-name-input").waitForExistence(timeout: 5))
    record("dark-relationship-picker")
    element(app, "workspace-relationship-cancel-action").tap()
    MobilePanelNavigation.toggleProperties(app)
    if !element(app, "sidebar-section-visibility-types").isHittable {
      MobilePanelNavigation.openSidebar(app)
    }
    element(app, "sidebar-section-visibility-types").tap()
    let row = element(app, "workspace-type-visibility-essay")
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertEqual(row.frame.height, 52, accuracy: 1)
    record("dark-type-picker")
    app.buttons["Cancel"].firstMatch.tap()
    element(app, "editor-source-action").tap()
    XCTAssertTrue(element(app, "editor-markdown-input").waitForExistence(timeout: 5))
    record("dark-source-editor")
    selectTheme(app, "system")
  }

  private func selectTheme(_ app: XCUIApplication, _ mode: String) {
    let settings = element(app, "open-mobile-settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 30))
    settings.tap()
    let option = element(app, "settings-theme-\(mode)")
    XCTAssertTrue(option.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(option.frame.height, 44)
    option.tap()
    XCTAssertTrue(option.waitForExistence(timeout: 2))
    app.buttons["Close settings"].tap()
  }

  private func assertDarkSurfaces(_ app: XCUIApplication) {
    assertSurface(app, x: 30, expected: [25, 24, 20])
    let editor = element(app, "editor-panel")
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    assertSurface(app, x: editor.frame.midX, expected: [31, 30, 27])
    record("native-desktop-dark-palette")
  }

  private func record(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func assertSurface(_ app: XCUIApplication, x: CGFloat, expected: [UInt8]) {
    let point = CGPoint(x: x, y: app.frame.height * 0.8)
    let predicate = NSPredicate { _, _ in
      let actual = NativeScreenshotColor.rgb(app.screenshot().image, at: point)
      return zip(actual, expected).allSatisfy { abs(Int($0) - Int($1)) <= 4 }
    }
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: 10), .completed)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
}

private enum NativeScreenshotColor {
  static func rgb(_ image: UIImage, at point: CGPoint) -> [UInt8] {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let pixel = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1), format: format).image { _ in
      image.draw(at: CGPoint(x: -point.x, y: -point.y))
    }
    var bytes = [UInt8](repeating: 0, count: 4)
    guard let source = pixel.cgImage,
          let context = CGContext(data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      return [0, 0, 0]
    }
    context.draw(source, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    return Array(bytes.prefix(3))
  }
}
