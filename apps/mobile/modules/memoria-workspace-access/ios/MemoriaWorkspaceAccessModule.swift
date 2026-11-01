import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

private let managedWorkspaceDirectoryName = "Memoria Vault"
private let managedWorkspaceLabelKey = "memoria.workspace.label"

private final class WorkspacePickerDelegate: NSObject, UIDocumentPickerDelegate,
  UIAdaptivePresentationControllerDelegate {
  private let onCancel: () -> Void
  private let onPick: (URL) -> Void

  init(onCancel: @escaping () -> Void, onPick: @escaping (URL) -> Void) {
    self.onCancel = onCancel
    self.onPick = onPick
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let source = urls.first else {
      onCancel()
      return
    }
    onPick(source)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    onCancel()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    onCancel()
  }
}

private struct WorkspacePickerContext {
  let delegate: WorkspacePickerDelegate
  let promise: Promise
}

public class MemoriaWorkspaceAccessModule: Module {
  private var pickerContext: WorkspacePickerContext?
  private let gitMetadata = Result { try WorkspaceGitMetadata() }
  private let backgroundSync = WorkspaceBackgroundLease { token in
    UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: token))
  }

  public func definition() -> ModuleDefinition {
    Name("MemoriaWorkspaceAccess")
    Events("workspaceSyncExpired")

    AsyncFunction("beginWorkspaceSync", self.beginSync).runOnQueue(.main)

    AsyncFunction("endWorkspaceSync", self.backgroundSync.end).runOnQueue(.main)

    OnDestroy {
      let lease = self.backgroundSync
      DispatchQueue.main.async { lease.endAll() }
    }

    Function("gitEntryInfo") { (uri: String) throws -> [String: Any] in
      return try self.gitMetadata.get().info(uri)
    }

    AsyncFunction("saveWorkspaceText") { (uri: String, path: String, content: String, identifier: String) throws in
      try managedWorkspaceText(uri).write(path, content: content, identifier: identifier)
    }

    AsyncFunction("saveWorkspaceTexts", self.saveTexts)

    Function("recoverWorkspaceText") { (uri: String) throws -> Bool in
      return try managedWorkspaceText(uri).recover()
    }

    Function("createWorkspaceOperationId") { () -> String in UUID().uuidString }

    AsyncFunction("changeWorkspaceEntry") { (uri: String, path: String, toPath: String?, directory: Bool, identifier: String) throws in
      try managedWorkspaceText(uri).changeEntry(.init(path: path, toPath: toPath, directory: directory, identifier: identifier))
    }

    AsyncFunction("importWorkspace", self.importWorkspace)

    AsyncFunction("pickAndImportWorkspace", self.presentWorkspacePicker).runOnQueue(.main)

    AsyncFunction("restoreWorkspace", self.restoreWorkspace)

    AsyncFunction("readWorkspaceIndex", self.readWorkspaceIndex)

    Function("isWorkspaceLinked") { (uri: String) throws -> Bool in
      return try LinkedWorkspaceStore().session(uri).isLinked
    }

    AsyncFunction("syncLinkedWorkspace") { (uri: String) throws -> [String: Bool] in
      return try LinkedWorkspaceStore().sync(uri)
    }

    AsyncFunction("reviewLinkedConflicts", self.reviewConflicts)

    AsyncFunction("resolveLinkedConflicts", self.resolveConflicts)

    #if DEBUG || MEMORIA_QA
    Constant("nativeStorageQAEnabled") { true }

    AsyncFunction("runLinkedBackgroundProbe") { () throws -> Bool in
      return try runLinkedWorkspaceBackgroundProof() && runLinkedConflictNativeProof()
    }

    AsyncFunction("runEntryRecoveryProbe") { (phase: String) throws -> [String: Any] in
      return try runWorkspaceEntryNativeProof(phase)
    }

    AsyncFunction("runTextRecoveryProbe") { (phase: String) throws -> [String: Any] in
      return try runWorkspaceTextRecoveryNativeProof(phase)
    }

    AsyncFunction("runFileAccessProbe") { () throws -> [String: Bool] in
      return try runWorkspaceFileNativeProof()
    }
    #endif
  }

  private func readWorkspaceIndex(_ uri: String) throws -> String {
    let store = try managedWorkspaceText(uri)
    workspaceMutationLock.lock()
    do {
      _ = try store.recover()
      try requireWorkspaceMutationRoot(store.root)
      workspaceMutationLock.unlock()
    } catch {
      workspaceMutationLock.unlock()
      throw error
    }
    return try WorkspaceFileIndex(root: store.root).json()
  }

  private func importWorkspace(_ uri: String) throws -> [String: String]? {
    guard let source = URL(string: uri), source.isFileURL else { return nil }

    let usesSecurityScope = source.startAccessingSecurityScopedResource()
    defer {
      if usesSecurityScope {
        source.stopAccessingSecurityScopedResource()
      }
    }
    guard usesSecurityScope || FileManager.default.isReadableFile(atPath: source.path) else {
      return nil
    }

    return try copyWorkspace(from: source)
  }

  private func saveTexts(_ uri: String, changes: [[String: String]], identifier: String) throws {
    let entries = try changes.map { change -> WorkspaceTextChange in
      guard let path = change["path"], let content = change["content"] else { throw WorkspaceFileError.invalidPath }
      return WorkspaceTextChange(path: path, content: content)
    }
    try managedWorkspaceText(uri).writeBatch(entries, identifier: identifier)
  }

  private func beginSync(_ identifier: String) -> Bool {
    backgroundSync.begin(identifier, request: { expiration in
      let token = UIApplication.shared.beginBackgroundTask(withName: "Memoria vault sync", expirationHandler: expiration)
      return token == .invalid ? nil : token.rawValue
    }, expired: { [weak self] in
      self?.sendEvent("workspaceSyncExpired", ["identifier": identifier])
    })
  }

  private func reviewConflicts(_ uri: String) throws -> String {
    let review = try LinkedWorkspaceStore().session(uri).reviewConflicts()
    guard let json = String(bytes: try JSONEncoder().encode(review), encoding: .utf8) else {
      throw CocoaError(.fileReadInapplicableStringEncoding)
    }
    return json
  }

  private func resolveConflicts(_ uri: String, review: String, choices: [String: String]) throws -> Bool {
    let decoded = try JSONDecoder().decode(LinkedConflictReview.self, from: Data(review.utf8))
    do {
      try LinkedWorkspaceStore().session(uri).resolveConflicts(decoded, choices: choices)
      return true
    } catch LinkedWorkspaceError.conflict { return false }
  }

  private func copyWorkspace(from source: URL) throws -> [String: String] {
    let label = source.deletingPathExtension().lastPathComponent
    guard !label.isEmpty else { throw WorkspaceFileError.invalidPath }

    let managed = try managedWorkspaceURL().deletingLastPathComponent()
      .appendingPathComponent("Local Vaults", isDirectory: true)
      .appendingPathComponent("local-" + UUID().uuidString.lowercased(), isDirectory: true)
    try FileManager.default.createDirectory(at: managed.deletingLastPathComponent(), withIntermediateDirectories: true)
    try managedWorkspaceText(managed.absoluteString).recover()
    let indexJson = try LinkedWorkspaceStore().connect(source: source, cache: managed)
    return ["indexJson": indexJson, "label": label, "uri": managed.absoluteString]
  }

  private func presentWorkspacePicker(_ promise: Promise) {
    guard pickerContext == nil else {
      promise.resolve(nil)
      return
    }
    guard let currentViewController = appContext?.utilities?.currentViewController() else {
      promise.resolve(nil)
      return
    }

    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
    let delegate = WorkspacePickerDelegate(
      onCancel: { [weak self] in self?.cancelWorkspacePicker() },
      onPick: { [weak self] source in self?.importPickedWorkspace(source) }
    )
    picker.allowsMultipleSelection = false
    picker.delegate = delegate
    picker.presentationController?.delegate = delegate

    pickerContext = WorkspacePickerContext(delegate: delegate, promise: promise)
    currentViewController.present(picker, animated: true)
  }

  private func importPickedWorkspace(_ source: URL) {
    guard let promise = takePickerPromise() else { return }
    let usesSecurityScope = source.startAccessingSecurityScopedResource()
    guard usesSecurityScope || FileManager.default.isReadableFile(atPath: source.path) else {
      promise.reject(CocoaError(.fileReadNoPermission))
      return
    }

    DispatchQueue.global(qos: .userInitiated).async {
      defer { if usesSecurityScope { source.stopAccessingSecurityScopedResource() } }
      do {
        promise.resolve(try self.copyWorkspace(from: source))
      } catch {
        promise.reject(error)
      }
    }
  }

  private func cancelWorkspacePicker() {
    takePickerPromise()?.resolve(nil)
  }

  private func takePickerPromise() -> Promise? {
    let promise = pickerContext?.promise
    pickerContext = nil
    return promise
  }

  private func restoreWorkspace() throws -> [String: String]? {
    guard let label = UserDefaults.standard.string(forKey: managedWorkspaceLabelKey) else {
      return nil
    }
    let managed = try managedWorkspaceURL()
    return try workspaceRecord(root: managed, label: label)
  }

  private func managedWorkspaceURL() throws -> URL {
    let documents = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    return documents.appendingPathComponent(managedWorkspaceDirectoryName, isDirectory: true)
  }

  private func workspaceRecord(root: URL, label: String) throws -> [String: String] {
    try managedWorkspaceText(root.absoluteString).recover()
    return [
      "indexJson": try WorkspaceFileIndex(root: root).json(),
      "label": label,
      "uri": root.absoluteString,
    ]
  }
}
