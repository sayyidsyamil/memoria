import Foundation

func managedWorkspaceText(_ uri: String, home: URL = URL(fileURLWithPath: NSHomeDirectory())) throws -> WorkspaceTextRecovery {
  let relative = try managedWorkspaceRelativePath(uri, home: home)
  let validatedRoot = try workspaceFileURL(root: home, path: relative)
  // A container's UUID changes after installation; the home-relative identity does not.
  let key = textRecoveryDigest(Data(relative.utf8))
  let journal = home.appendingPathComponent("Library/Application Support/MemoriaWorkspaceWrites/\(key).json")
  return WorkspaceTextRecovery(root: validatedRoot, journal: journal)
}
