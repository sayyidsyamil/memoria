import Foundation
import Sentry

enum NativeCrashFrames {
  static func stack(_ source: SentryStacktrace?) -> SentryStacktrace? {
    guard let source else { return nil }
    return SentryStacktrace(frames: source.frames.suffix(80).map(frame), registers: [:])
  }

  static func frame(_ source: Frame) -> Frame {
    let clean = Frame()
    clean.instructionAddress = address(source.instructionAddress)
    clean.imageAddress = address(source.imageAddress)
    clean.symbolAddress = address(source.symbolAddress)
    clean.inApp = source.inApp
    clean.platform = "cocoa"
    return clean
  }

  static func image(_ source: DebugMeta) -> DebugMeta? {
    guard let id = source.debugID, UUID(uuidString: id) != nil else { return nil }
    let clean = DebugMeta()
    clean.type = "macho"
    clean.debugID = id
    clean.imageAddress = address(source.imageAddress)
    clean.imageVmAddress = address(source.imageVmAddress)
    clean.imageSize = source.imageSize
    return clean
  }

  private static func address(_ value: String?) -> String? {
    guard let value, value.count <= 18,
      value.range(of: "^0x[0-9a-fA-F]+$", options: .regularExpression) != nil else { return nil }
    return value
  }
}
