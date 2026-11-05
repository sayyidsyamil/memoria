// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "MemoriaCrashPrivacy",
  platforms: [.macOS(.v13), .iOS(.v15)],
  dependencies: [.package(url: "https://github.com/getsentry/sentry-cocoa.git", exact: "8.58.0")],
  targets: [
    .target(name: "MemoriaCrashPrivacy", dependencies: [.product(name: "Sentry", package: "sentry-cocoa")],
      path: "ios", exclude: ["MemoriaCrashReportingModule.swift", "MemoriaCrashReporting.podspec", "PrivacyInfo.xcprivacy"]),
    .testTarget(name: "MemoriaCrashPrivacyTests", dependencies: ["MemoriaCrashPrivacy"], path: "tests"),
  ]
)
