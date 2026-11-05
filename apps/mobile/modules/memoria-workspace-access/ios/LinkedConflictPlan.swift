import Foundation

struct LinkedConflictOrigin {
  let remote: Bool
  let path: String
}

struct LinkedConflictPlan {
  private(set) var merged: [String: String] = [:]
  private(set) var origins: [String: LinkedConflictOrigin] = [:]
  private(set) var conflicts: [String] = []
  let base: [String: String]
  let local: [String: String]
  let remote: [String: String]
  let choices: [String: String]

  init(base: [String: String], local: [String: String], remote: [String: String], choices: [String: String] = [:]) throws {
    self.base = base
    self.local = local
    self.remote = remote
    self.choices = choices
    try visitChildren("")
  }

  private mutating func visitChildren(_ prefix: String) throws {
    let paths = Set(base.keys).union(local.keys).union(remote.keys)
    let names = Set(paths.filter { $0.hasPrefix(prefix) }.compactMap { $0.dropFirst(prefix.count).split(separator: "/").first.map(String.init) })
    var occupied = names
    for name in names.sorted() { try visit(prefix + name, occupied: &occupied) }
  }

  private mutating func visit(_ path: String, occupied: inout Set<String>) throws {
    guard path.split(separator: "/").count < 128 else { throw LinkedWorkspaceError.invalidState }
    let left = subtree(local, path)
    let right = subtree(remote, path)
    let ancestor = subtree(base, path)
    if left == right || right == ancestor { copy(left, from: path, to: path, remote: false); return }
    if left == ancestor { copy(right, from: path, to: path, remote: true); return }
    if local[path] == "directory", remote[path] == "directory", base[path] == nil || base[path] == "directory" {
      merged[path] = "directory"
      origins[path] = LinkedConflictOrigin(remote: false, path: path)
      try visitChildren(path + "/")
      return
    }
    conflicts.append(path)
    try choose(path, left: left, right: right, occupied: &occupied)
  }

  private mutating func choose(_ path: String, left: [String: String], right: [String: String], occupied: inout Set<String>) throws {
    switch choices[path] {
    case "remote": copy(right, from: path, to: path, remote: true)
    case "both":
      copy(left, from: path, to: path, remote: false)
      let destination = left.isEmpty ? path : conflictName(path, occupied: &occupied)
      copy(right, from: path, to: destination, remote: true)
    case nil, "local": copy(left, from: path, to: path, remote: false)
    default: throw LinkedWorkspaceError.invalidState
    }
  }

  private mutating func copy(_ entries: [String: String], from: String, to: String, remote: Bool) {
    for (path, value) in entries {
      let destination = to + path.dropFirst(from.count)
      merged[destination] = value
      origins[destination] = LinkedConflictOrigin(remote: remote, path: path)
    }
  }
}

private func subtree(_ entries: [String: String], _ path: String) -> [String: String] {
  entries.filter { $0.key == path || $0.key.hasPrefix(path + "/") }
}

private func conflictName(_ path: String, occupied: inout Set<String>) -> String {
  let url = URL(fileURLWithPath: path)
  let name = url.lastPathComponent
  let ext = url.pathExtension
  let suffix = ext.isEmpty ? "" : "." + ext
  let stem = String(name.dropLast(suffix.count))
  var index = 1
  var candidate = "\(stem) (conflict \(index))\(suffix)"
  while occupied.contains(candidate) { index += 1; candidate = "\(stem) (conflict \(index))\(suffix)" }
  occupied.insert(candidate)
  return String(path.dropLast(name.count)) + candidate
}
