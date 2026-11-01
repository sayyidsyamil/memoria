import Sentry

enum NativeCrashPrivacy {
  static func sanitize(_ source: Event, context: NativeCrashContext) -> Event {
    let context = context.preservingCrashBuild(source.releaseName)
    let clean = Event(level: source.level)
    clean.eventId = source.eventId
    clean.timestamp = source.timestamp
    clean.platform = "cocoa"
    clean.releaseName = context.release
    clean.dist = context.build
    clean.environment = context.environment
    clean.tags = context.tags
    clean.exceptions = source.exceptions?.prefix(4).map(exception)
    clean.threads = source.threads.map(prioritizedThreads)
    clean.stacktrace = NativeCrashFrames.stack(source.stacktrace)
    clean.debugMeta = source.debugMeta?.prefix(256).compactMap(NativeCrashFrames.image)
    return clean
  }

  private static func exception(_ source: Exception) -> Exception {
    let clean = Exception(value: "Native application failure", type: "NativeCrash")
    clean.threadId = source.threadId
    clean.stacktrace = NativeCrashFrames.stack(source.stacktrace)
    let mechanism = Mechanism(type: "native")
    mechanism.handled = source.mechanism?.handled
    clean.mechanism = mechanism
    return clean
  }

  private static func thread(_ source: SentryThread) -> SentryThread {
    let clean = SentryThread(threadId: source.threadId)
    clean.crashed = source.crashed
    clean.current = source.current
    clean.isMain = source.isMain
    clean.stacktrace = NativeCrashFrames.stack(source.stacktrace)
    return clean
  }

  private static func prioritizedThreads(_ source: [SentryThread]) -> [SentryThread] {
    let crashed = source.filter { $0.crashed == true }
    let remaining = source.filter { $0.crashed != true }
    return (crashed + remaining).prefix(32).map(thread)
  }
}
