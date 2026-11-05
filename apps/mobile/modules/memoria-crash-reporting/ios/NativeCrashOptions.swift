import Foundation
import Sentry

struct NativeCrashOptions {
  let dsn: String
  let context: NativeCrashContext
  let directory: URL
  let session: URLSession

  func make(consent: NativeCrashConsent, lease: Int) -> Options {
    let options = Options()
    options.dsn = dsn
    options.releaseName = context.release
    options.dist = context.build
    options.environment = context.environment
    options.cacheDirectoryPath = directory.path
    options.urlSession = session
    options.shutdownTimeInterval = 0
    options.maxCacheItems = 8
    options.maxBreadcrumbs = 0
    options.sendDefaultPii = false
    options.sendClientReports = false
    options.maxAttachmentSize = 0
    options.enableSwizzling = false
    options.enableAutoBreadcrumbTracking = false
    options.enableAutoSessionTracking = false
    options.enableWatchdogTerminationTracking = false
    options.enableAutoPerformanceTracing = false
    options.enableAppHangTracking = false
    options.enableCaptureFailedRequests = false
    options.enableNetworkTracking = false
    options.enableFileIOTracing = false
    options.enableCoreDataTracing = false
    options.tracesSampleRate = 0
    options.beforeBreadcrumb = { _ in nil }
    options.beforeSend = { event in
      guard consent.allows(lease) else { return nil }
      return NativeCrashPrivacy.sanitize(event, context: context)
    }
    configureSimulatorProof(options)
    return options
  }

  private func configureSimulatorProof(_ options: Options) {
    #if targetEnvironment(simulator)
    guard ProcessInfo.processInfo.arguments.contains("--memoria-native-crash-proof") else { return }
    options.onCrashedLastRun = { event in
      let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      let proof = root.appendingPathComponent("MemoriaNativeCrashProof.json")
      try? JSONSerialization.data(withJSONObject: event.serialize()).write(to: proof, options: .atomic)
    }
    #endif
  }
}
