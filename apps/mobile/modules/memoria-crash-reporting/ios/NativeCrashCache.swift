import Foundation

final class NativeCrashCache {
  private let root: URL
  private let defaults: UserDefaults
  private let key = "MemoriaNativeCrashCacheGeneration"

  init(root: URL, defaults: UserDefaults = .standard) {
    self.root = root
    self.defaults = defaults
  }

  func directory() throws -> URL {
    let identifier = defaults.string(forKey: key).flatMap(UUID.init(uuidString:)) ?? UUID()
    defaults.set(identifier.uuidString, forKey: key)
    let directory = root.appendingPathComponent(identifier.uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  func revoke() throws {
    // Detach before deletion: late SDK writes can never rejoin a future consent session.
    defaults.removeObject(forKey: key)
    if FileManager.default.fileExists(atPath: root.path) {
      try FileManager.default.removeItem(at: root)
    }
  }
}
