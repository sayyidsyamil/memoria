import Foundation

final class NativeCrashConsent {
  private let lock = NSLock()
  private var generation = 0
  private var enabled = false

  func activate() -> Int {
    lock.lock()
    defer { lock.unlock() }
    generation += 1
    enabled = true
    return generation
  }

  func revoke() {
    lock.lock()
    defer { lock.unlock() }
    enabled = false
    generation += 1
  }

  func allows(_ lease: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return enabled && generation == lease
  }
}
