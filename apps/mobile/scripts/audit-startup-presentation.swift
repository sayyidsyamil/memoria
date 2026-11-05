import AppKit
import AVFoundation
import Foundation
import Vision

enum StartupFrame: String, Codable { case preview, ready, other }
enum StartupAuditError: Error { case arguments, duration, frameEncoding, missingPreview, missingReady, latePreview }

struct StartupSample: Codable {
  let seconds: Double
  let state: StartupFrame
}

func recognizedLines(_ image: CGImage) throws -> [VNRecognizedTextObservation] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["en-US"]
  try VNImageRequestHandler(cgImage: image).perform([request])
  return request.results ?? []
}

func frameState(_ text: String) -> StartupFrame {
  guard text.contains("startup note") else { return .other }
  return text.contains("loading") ? .preview : .ready
}

func saveFrame(_ image: CGImage, to destination: URL) throws {
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]) else { throw StartupAuditError.frameEncoding }
  try data.write(to: destination)
}

func auditStartup(video: URL, output: URL) async throws {
  let asset = AVURLAsset(url: video)
  let duration = CMTimeGetSeconds(try await asset.load(.duration))
  guard duration.isFinite, duration > 0, duration < 120 else { throw StartupAuditError.duration }
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  var samples: [StartupSample] = []
  var saved = Set<StartupFrame>()
  for index in 0..<Int(duration * 10) {
    let seconds = Double(index) / 10
    let (image, _) = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
    let lines = try recognizedLines(image)
    let text = lines.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").lowercased()
    let state = frameState(text)
    samples.append(StartupSample(seconds: seconds, state: state))
    if state != .other, saved.insert(state).inserted {
      try saveFrame(image, to: output.appendingPathComponent("\(state.rawValue).png"))
    }
  }
  try JSONEncoder().encode(samples).write(to: output.appendingPathComponent("samples.json"))
  try validatePresentationOrder(samples)
}

func validatePresentationOrder(_ samples: [StartupSample]) throws {
  guard let preview = samples.first(where: { $0.state == .preview }) else { throw StartupAuditError.missingPreview }
  guard let ready = samples.first(where: { $0.state == .ready }) else { throw StartupAuditError.missingReady }
  guard preview.seconds < ready.seconds else { throw StartupAuditError.latePreview }
  if samples.contains(where: { $0.seconds >= ready.seconds && $0.state == .preview }) {
    throw StartupAuditError.latePreview
  }
}

do {
  guard CommandLine.arguments.count == 3 else { throw StartupAuditError.arguments }
  try await auditStartup(video: URL(fileURLWithPath: CommandLine.arguments[1]), output: URL(fileURLWithPath: CommandLine.arguments[2]))
} catch {
  FileHandle.standardError.write(Data("Startup video audit failed: \(error)\n".utf8))
  exit(1)
}
