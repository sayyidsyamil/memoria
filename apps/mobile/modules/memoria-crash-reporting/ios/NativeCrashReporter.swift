import Foundation
import Sentry

final class NativeCrashReporter {
  private let consent = NativeCrashConsent()
  private let cache: NativeCrashCache
  private var session: URLSession?

  init() {
    let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("MemoriaNativeCrashes", isDirectory: true)
    cache = NativeCrashCache(root: root)
  }

  func start(dsn: String, metadata: [String: String]) throws {
    guard session == nil else { return }
    let directory = try cache.directory()
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 5
    config.timeoutIntervalForResource = 10
    let transport = URLSession(configuration: config)
    session = transport
    let configuration = NativeCrashOptions(dsn: dsn, context: NativeCrashContext(metadata),
      directory: directory, session: transport)
    let options = configuration.make(consent: consent, lease: consent.activate())
    SentrySDK.start(options: options)
  }

  func stop() {
    consent.revoke()
    session?.invalidateAndCancel()
    if session != nil { SentrySDK.close() }
    session = nil
    // Revocation detaches the cache even if best-effort file removal fails.
    try? cache.revoke()
  }
}
