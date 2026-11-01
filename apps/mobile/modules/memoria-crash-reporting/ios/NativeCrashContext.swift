import Foundation

struct NativeCrashContext {
  let tags: [String: String]
  let release: String
  let build: String
  let environment: String

  init(_ values: [String: String]) {
    let version = Self.version(values["app_version"])
    build = Self.version(values["build_number"])
    release = "memoria-mobile@\(version)+\(build)"
    environment = Self.choice(values["distribution"], ["internal", "testflight", "store"], "internal")
    tags = ["app_surface": "mobile", "platform": "ios", "app_version": version, "build_number": build,
      "distribution": environment,
      "device_family": Self.choice(values["device_family"], ["phone", "tablet"], "unknown"),
      "release_channel": Self.choice(values["release_channel"], ["alpha", "stable"], "alpha")]
  }

  func preservingCrashBuild(_ releaseName: String?) -> NativeCrashContext {
    guard let releaseName, releaseName.hasPrefix("memoria-mobile@") else { return self }
    let parts = releaseName.dropFirst("memoria-mobile@".count).split(separator: "+")
    guard parts.count == 2 else { return self }
    var values = tags
    values["app_version"] = String(parts[0])
    values["build_number"] = String(parts[1])
    return NativeCrashContext(values)
  }

  private static func version(_ value: String?) -> String {
    guard let value, value.count <= 40,
      value.range(of: "^[0-9][0-9.a-z-]*$", options: .regularExpression) != nil else { return "0" }
    return value
  }

  private static func choice(_ value: String?, _ allowed: [String], _ fallback: String) -> String {
    allowed.first { $0 == value } ?? fallback
  }
}
