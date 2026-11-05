import Foundation

// Calls are serialized on the UIKit main queue, including expiration.
final class WorkspaceBackgroundLease {
  private struct Lease {
    let identifier: String
    var token: Int?
  }
  private var current: Lease?
  private let release: (Int) -> Void

  init(release: @escaping (Int) -> Void) { self.release = release }

  func begin(_ identifier: String, request: (@escaping () -> Void) -> Int?, expired: @escaping () -> Void) -> Bool {
    guard current == nil else { return false }
    current = Lease(identifier: identifier)
    let token = request { [weak self] in
      if self?.end(identifier) == true { expired() }
    }
    guard current?.identifier == identifier else {
      if let token { release(token) }
      return false
    }
    guard let token else { current = nil; return false }
    current?.token = token
    return true
  }

  @discardableResult
  func end(_ identifier: String) -> Bool {
    guard let lease = current, lease.identifier == identifier else { return false }
    current = nil
    if let token = lease.token { release(token) }
    return true
  }

  func endAll() {
    if let identifier = current?.identifier { end(identifier) }
  }
}
