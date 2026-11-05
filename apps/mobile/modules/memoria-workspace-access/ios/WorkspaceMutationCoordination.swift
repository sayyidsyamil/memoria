import Darwin
import Foundation

// Saves, replay, and structural changes must share one exclusion boundary.
let workspaceMutationLock = NSRecursiveLock()

func requireWorkspaceMutationRoot(_ root: URL) throws {
  let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
  guard values.isDirectory == true, values.isSymbolicLink != true else {
    throw WorkspaceTextRecoveryError.missingRoot
  }
  if FileManager.default.fileExists(atPath: root.appendingPathComponent(".git/memoria-checkout.json").path) {
    throw WorkspaceTextRecoveryError.checkoutPending
  }
}

func coordinateWorkspaceRelocation(_ source: URL, _ destination: URL, action: @escaping () throws -> Void) throws {
  var coordinationError: NSError?
  var result: Result<Void, Error>?
  NSFileCoordinator().coordinate(
    writingItemAt: source, options: .forMoving,
    writingItemAt: destination, options: .forReplacing, error: &coordinationError
  ) { _, _ in result = Result { try action() } }
  if let coordinationError { throw coordinationError }
  guard let result else { throw WorkspaceFileError.coordinationFailed }
  try result.get()
}

func relocateWorkspaceEntry(_ source: URL, _ destination: URL) throws {
  // Exclusive same-volume rename cannot overwrite a late collision or degrade
  // into a partially completed cross-volume copy/delete.
  if renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) != 0 {
    throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
  }
}
