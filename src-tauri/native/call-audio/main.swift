// memoria-call-audio: records the audio this Mac plays, such as the other side of a call, for a Memoria meeting.
//
// A Core Audio process tap (macOS 14.2 or later) mixes the output of every process except Memoria's own to mono. It is
// read through a private aggregate device whose clock is the default output device, converted to 16 kHz mono float32
// and written to stdout, unbuffered, in frames of 1,600 little-endian samples (100 ms). Silence arrives as zeros, and so
// does everything while macOS has not granted System Audio Recording to the app that started this helper.
//
// Stops cleanly (IO stopped, aggregate device and tap destroyed) when stdin closes, which is how the parent going away
// shows, and on SIGTERM or SIGINT. A failure is one JSON line, {"error": "..."}, on stderr and a non-zero exit. A new
// default output device (headphones plugged in or removed) rebuilds the tap and aggregate device on it. `--verbose`
// writes diagnostic lines to stderr, which the app ignores; `--test-tone` replaces the tap with a synthetic tone.
import AVFoundation
import CoreAudio
import Darwin
import Foundation
import os

let outputRate = 16_000.0
let frameSamples = 1_600
let verbose = CommandLine.arguments.contains("--verbose")
let system = AudioObjectID(kAudioObjectSystemObject)

/// stderr through write(2): FileHandle raises an exception when the parent has closed the pipe.
func writeError(_ text: String) {
    var bytes = Array(text.utf8)
    _ = Darwin.write(STDERR_FILENO, &bytes, bytes.count)
}

func note(_ message: @autoclosure () -> String) {
    if verbose { writeError("memoria-call-audio: \(message())\n") }
}

/// Reports a failure the way the app reads it, then exits at once (stderr is unbuffered; Core Audio's exit-time teardown
/// could block). Callers release what they created first; the system removes a private tap and aggregate device anyway.
func fail(_ message: String) -> Never {
    let line = (try? JSONSerialization.data(withJSONObject: ["error": message])).flatMap { String(data: $0, encoding: .utf8) }
    writeError((line ?? #"{"error":"call audio failed"}"#) + "\n")
    _exit(1)
}

struct Failure: Error, CustomStringConvertible { let description: String }

/// An OSStatus in plain words, with its code for a bug report.
func words(_ status: OSStatus) -> String {
    let meaning: String
    switch status {
    case kAudioHardwareNotRunningError: meaning = "the audio system is not running"
    case kAudioHardwareUnspecifiedError: meaning = "the audio system reported an unspecified error"
    case kAudioHardwareUnknownPropertyError: meaning = "the audio system does not know a requested setting"
    case kAudioHardwareBadPropertySizeError: meaning = "a setting had the wrong size"
    case kAudioHardwareIllegalOperationError: meaning = "the audio system refused the operation"
    case kAudioHardwareBadObjectError: meaning = "an audio object no longer exists"
    case kAudioHardwareBadDeviceError: meaning = "the audio device is no longer available"
    case kAudioHardwareBadStreamError: meaning = "an audio stream is no longer available"
    case kAudioHardwareUnsupportedOperationError: meaning = "this Mac does not support the operation"
    case kAudioHardwareNotReadyError: meaning = "the audio system is not ready"
    case kAudioDeviceUnsupportedFormatError: meaning = "the audio format is not supported"
    case kAudioDevicePermissionsError: meaning = "macOS denied access to the audio device"
    case OSStatus(paramErr): meaning = "an invalid value was passed"
    default: meaning = "an unexpected error"
    }
    let bytes = withUnsafeBytes(of: UInt32(bitPattern: status).bigEndian) { Array($0) }
    let code = bytes.allSatisfy { (32...126).contains($0) } ? "'\(String(decoding: bytes, as: UTF8.self))', " : ""
    return "\(meaning); Core Audio error \(code)\(status)"
}

func check(_ status: OSStatus, _ what: String) throws {
    if status != noErr { throw Failure(description: "\(what) (\(words(status)))") }
}

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func read<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T, _ what: String) throws -> T {
    var property = address(selector)
    var size = UInt32(MemoryLayout<T>.size)
    var value = initial
    try check(withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &property, 0, nil, &size, $0) }, what)
    return value
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var property = address(selector)
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var value: Unmanaged<CFString>?
    guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
}

func defaultOutput() -> AudioObjectID? {
    let device = try? read(system, kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(kAudioObjectUnknown), "")
    return device == kAudioObjectUnknown ? nil : device
}

/// The channel count of each buffer the device's IOProc receives as input, in order.
func inputBuffers(_ device: AudioObjectID) -> [Int] {
    var property = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &property, 0, nil, &size) == noErr, size > 0 else { return [] }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(device, &property, 0, nil, &size, raw) == noErr else { return [] }
    return UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self)).map { Int($0.mNumberChannels) }
}

func inputStreamCount(_ device: AudioObjectID) -> Int {
    var property = address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(device, &property, 0, nil, &size) == noErr ? Int(size) / MemoryLayout<AudioObjectID>.size : 0
}

/// Memoria's own process, when Core Audio knows it. A process that plays nothing has no process object, and audio from
/// Memoria's web view is played by WebKit's media process, which this does not exclude.
func parentProcess() -> [AudioObjectID] {
    var pid = getppid()
    var property = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var object = AudioObjectID(kAudioObjectUnknown)
    let status = AudioObjectGetPropertyData(system, &property, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
    return status == noErr && object != kAudioObjectUnknown ? [object] : []
}

func nanoseconds() -> UInt64 { DispatchTime.now().uptimeNanoseconds }

/// Tap samples handed from the real-time IO thread to the writer. Bounded: if the writer falls behind, the oldest go.
final class SampleRing {
    private let lock = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    private let storage: UnsafeMutablePointer<Float>
    private let capacity: Int
    private let channels: Int
    private var start = 0
    private var count = 0
    private var lastWrite: UInt64 = 0

    init(seconds: Double, rate: Double, channels: Int) {
        self.channels = channels
        capacity = max(1, Int(seconds * rate)) * channels
        storage = .allocate(capacity: capacity)
        lock.initialize(to: os_unfair_lock())
    }

    deinit {
        storage.deallocate()
        lock.deinitialize(count: 1)
        lock.deallocate()
    }

    /// `samples` is interleaved and a whole number of frames.
    func write(_ samples: UnsafePointer<Float>, _ total: Int) {
        os_unfair_lock_lock(lock)
        defer { os_unfair_lock_unlock(lock) }
        lastWrite = nanoseconds()
        var remaining = min(total, capacity)
        var source = samples + (total - remaining)
        let overflow = count + remaining - capacity
        if overflow > 0 {
            let dropped = (overflow + channels - 1) / channels * channels
            start = (start + dropped) % capacity
            count -= dropped
        }
        var end = (start + count) % capacity
        count += remaining
        while remaining > 0 {
            let chunk = min(remaining, capacity - end)
            (storage + end).update(from: source, count: chunk)
            source += chunk
            remaining -= chunk
            end = (end + chunk) % capacity
        }
    }

    /// Takes up to `limit` samples, a whole number of frames.
    func read(into destination: UnsafeMutablePointer<Float>, limit: Int) -> Int {
        os_unfair_lock_lock(lock)
        defer { os_unfair_lock_unlock(lock) }
        let total = min(limit, count) / channels * channels
        var copied = 0
        while copied < total {
            let chunk = min(total - copied, capacity - start)
            (destination + copied).update(from: storage + start, count: chunk)
            start = (start + chunk) % capacity
            copied += chunk
        }
        count -= total
        return total
    }

    /// When the IO thread last delivered audio, or 0 if it never has.
    var lastWriteTime: UInt64 {
        os_unfair_lock_lock(lock)
        defer { os_unfair_lock_unlock(lock) }
        return lastWrite
    }
}

/// What the writer converts: interleaved float32 samples in `format`, delivered through `ring`.
final class Source {
    let format: AudioStreamBasicDescription
    let channels: Int
    let ring: SampleRing

    init(format: AudioStreamBasicDescription) {
        self.format = format
        channels = Int(format.mChannelsPerFrame)
        ring = SampleRing(seconds: 2, rate: format.mSampleRate, channels: channels)
    }
}

/// One tap and its private aggregate device on the default output device, with the IOProc that feeds `source`.
@available(macOS 14.2, *)
final class TapSession {
    let device: AudioObjectID
    let source: Source
    private let tap: AudioObjectID
    private let aggregate: AudioObjectID
    /// The channel count of each IOProc input buffer. An output device with inputs of its own (a USB headset) adds
    /// those: the aggregate device lists its sub-device's streams first and the tap's last.
    private let inputs: [Int]
    private var proc: AudioDeviceIOProcID?
    private var listener: AudioObjectPropertyListenerBlock?
    private let queue: DispatchQueue

    private init(device: AudioObjectID, tap: AudioObjectID, aggregate: AudioObjectID, format: AudioStreamBasicDescription, inputs: [Int], queue: DispatchQueue) {
        self.device = device
        self.tap = tap
        self.aggregate = aggregate
        self.inputs = inputs
        self.queue = queue
        source = Source(format: format)
    }

    private var tapBuffer: Int { inputs.count - 1 }

    static func make(queue: DispatchQueue) throws -> TapSession {
        guard let device = defaultOutput(), let deviceUID = readString(device, kAudioDevicePropertyDeviceUID) else {
            throw Failure(description: "this Mac has no audio output device")
        }
        let excluded = parentProcess()
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: excluded)
        description.uuid = UUID()
        description.name = "Memoria call audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        var aggregate = AudioObjectID(kAudioObjectUnknown)
        do {
            try check(AudioHardwareCreateProcessTap(description, &tap), "could not create the system audio tap")
            let format = try read(tap, kAudioTapPropertyFormat, AudioStreamBasicDescription(), "could not read the system audio format")
            guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
                  format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0 || format.mChannelsPerFrame == 1,
                  format.mBitsPerChannel == 32, format.mChannelsPerFrame > 0, format.mSampleRate > 0 else {
                throw Failure(description: "the system audio has an unsupported format")
            }
            let composition: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Memoria call audio",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceMainSubDeviceKey: deviceUID,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceIsStackedKey: false,
                kAudioAggregateDeviceTapAutoStartKey: false,
                kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: deviceUID]],
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
            ]
            try check(AudioHardwareCreateAggregateDevice(composition as CFDictionary, &aggregate), "could not create the capture device")
            let inputs = inputBuffers(aggregate)
            guard inputs.last == Int(format.mChannelsPerFrame) else {
                throw Failure(description: "the capture device has no stream for the system audio")
            }
            note("output \(readString(device, kAudioObjectPropertyName) ?? deviceUID); tap \(format.mSampleRate) Hz, \(format.mChannelsPerFrame) channel(s); input buffers \(inputs); excluded \(excluded)")
            return TapSession(device: device, tap: tap, aggregate: aggregate, format: format, inputs: inputs, queue: queue)
        } catch {
            if aggregate != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregate) }
            if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
            throw error
        }
    }

    /// False once the output device is gone or the tap's format differs from the one being converted.
    var isCurrent: Bool {
        let alive = (try? read(device, kAudioDevicePropertyDeviceIsAlive, UInt32(0), "")) ?? 0
        let now = try? read(tap, kAudioTapPropertyFormat, AudioStreamBasicDescription(), "")
        return alive != 0 && now?.mSampleRate == source.format.mSampleRate && now?.mChannelsPerFrame == source.format.mChannelsPerFrame
    }

    /// Starts IO. `changed` is called on the control queue when the output device goes away or the tap's format changes.
    func start(changed: @escaping (String) -> Void) throws {
        let ring = source.ring, index = tapBuffer, channels = source.channels
        var described = !verbose
        try check(AudioDeviceCreateIOProcIDWithBlock(&proc, aggregate, nil) { _, input, _, output, _ in
            // The aggregate device has the output device's outputs too. This helper never plays anything.
            for buffer in UnsafeMutableAudioBufferListPointer(output) { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } }
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            if !described {
                described = true
                note("first IO: \(buffers.map { $0.mData == nil ? "unused" : "\($0.mNumberChannels) ch" })")
            }
            guard index < buffers.count, let data = buffers[index].mData else { return }
            let samples = Int(buffers[index].mDataByteSize) / MemoryLayout<Float>.size
            ring.write(data.assumingMemoryBound(to: Float.self), samples - samples % channels)
        }, "could not prepare the capture")
        useTapStreamOnly()
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            if let self, !self.isCurrent { changed("the output device or its format changed") }
        }
        self.listener = listener
        for selector in [kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyNominalSampleRate] {
            var property = address(selector)
            AudioObjectAddPropertyListenerBlock(device, &property, queue, listener)
        }
        var format = address(kAudioTapPropertyFormat)
        AudioObjectAddPropertyListenerBlock(tap, &format, queue, listener)
        try check(AudioDeviceStart(aggregate, proc), "could not start capturing")
    }

    /// Marks the output device's own input streams unused, so that a headset's microphone is not opened for the tap.
    private func useTapStreamOnly() {
        guard let proc, inputs.count > 1, inputStreamCount(aggregate) == inputs.count,
              let offset = MemoryLayout<AudioHardwareIOProcStreamUsage>.offset(of: \.mStreamIsOn) else { return }
        let size = offset + inputs.count * MemoryLayout<UInt32>.size
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioHardwareIOProcStreamUsage>.alignment)
        defer { raw.deallocate() }
        let usage = raw.bindMemory(to: AudioHardwareIOProcStreamUsage.self, capacity: 1)
        usage.pointee.mIOProc = unsafeBitCast(proc, to: UnsafeMutableRawPointer.self)
        usage.pointee.mNumberStreams = UInt32(inputs.count)
        let flags = (raw + offset).bindMemory(to: UInt32.self, capacity: inputs.count)
        for stream in inputs.indices { flags[stream] = stream == tapBuffer ? 1 : 0 }
        var property = address(kAudioDevicePropertyIOProcStreamUsage, kAudioObjectPropertyScopeInput)
        let status = AudioObjectSetPropertyData(aggregate, &property, 0, nil, UInt32(size), raw)
        note("only the tap's input stream is used: \(status == noErr ? "yes" : words(status))")
    }

    func destroy() {
        if let listener {
            for selector in [kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyNominalSampleRate] {
                var property = address(selector)
                AudioObjectRemovePropertyListenerBlock(device, &property, queue, listener)
            }
            var format = address(kAudioTapPropertyFormat)
            AudioObjectRemovePropertyListenerBlock(tap, &format, queue, listener)
            self.listener = nil
        }
        if let proc {
            let stopped = AudioDeviceStop(aggregate, proc)
            let released = AudioDeviceDestroyIOProcID(aggregate, proc)
            note("IO stopped: \(stopped), IOProc destroyed: \(released)")
            self.proc = nil
        }
        note("aggregate device destroyed: \(AudioHardwareDestroyAggregateDevice(aggregate)), tap destroyed: \(AudioHardwareDestroyProcessTap(tap))")
    }
}

/// Converts tap audio to 16 kHz mono float32, keeping the resampler's state between calls.
@available(macOS 14.2, *)
final class Converter {
    let frames: Int
    private let converter: AVAudioConverter
    private let input: AVAudioPCMBuffer
    private let output: AVAudioPCMBuffer
    private let bytesPerFrame: Int

    init(format: AudioStreamBasicDescription, frames: Int) throws {
        var description = format
        guard let from = AVAudioFormat(streamDescription: &description),
              let to = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outputRate, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: from, to: to),
              let input = AVAudioPCMBuffer(pcmFormat: from, frameCapacity: AVAudioFrameCount(frames)),
              let output = AVAudioPCMBuffer(pcmFormat: to, frameCapacity: AVAudioFrameCount(Double(frames) * outputRate / from.sampleRate) + 256) else {
            throw Failure(description: "could not convert the system audio to 16 kHz")
        }
        converter.downmix = true
        self.frames = frames
        self.converter = converter
        self.input = input
        self.output = output
        bytesPerFrame = Int(format.mChannelsPerFrame) * MemoryLayout<Float>.size
    }

    /// `count` interleaved frames in; `sink` receives the 16 kHz samples that are ready.
    func convert(_ samples: UnsafePointer<Float>, count: Int, sink: (UnsafePointer<Float>, Int) -> Void) throws {
        let buffers = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
        buffers[0].mData!.copyMemory(from: samples, byteCount: count * bytesPerFrame)
        input.frameLength = AVAudioFrameCount(count)
        var supplied = false
        var status = AVAudioConverterOutputStatus.haveData
        while status == .haveData {
            var error: NSError?
            output.frameLength = 0
            status = converter.convert(to: output, error: &error) { _, inputStatus in
                if supplied { inputStatus.pointee = .noDataNow; return nil }
                supplied = true
                inputStatus.pointee = .haveData
                return self.input
            }
            if status == .error { throw Failure(description: "could not convert the system audio to 16 kHz (\(error?.localizedDescription ?? "unknown error"))") }
            if output.frameLength > 0, let data = output.floatChannelData { sink(data[0], Int(output.frameLength)) }
        }
    }
}

@available(macOS 14.2, *)
final class CallAudio {
    private let control = DispatchQueue(label: "my.memoria.call-audio.control")
    private let state = NSLock()
    private var session: TapSession?
    private var writing: Source?
    private var finishing = false
    private var starting = false
    private var rebuilding = false
    private var listener: AudioObjectPropertyListenerBlock?
    private var signals: [DispatchSourceSignal] = []
    private var watchdog: DispatchSourceTimer?
    private var frames = 0
    private var audibleFrames = 0
    private var peak: Float = 0
    private let systemSelectors = [kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyServiceRestarted]

    func run() -> Never {
        signal(SIGPIPE, SIG_IGN)
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { [unowned self] in finish("signal \(number)") }
            source.resume()
            signals.append(source)
        }
        // Read before capture starts: AudioDeviceStart waits for as long as the macOS permission prompt is unanswered.
        Thread { [unowned self] in
            var buffer = [UInt8](repeating: 0, count: 256)
            while true {
                let count = Darwin.read(STDIN_FILENO, &buffer, buffer.count)
                if count > 0 || (count < 0 && errno == EINTR) { continue }
                break
            }
            finish("stdin closed")
        }.start()
        Thread { [unowned self] in write() }.start()
        if CommandLine.arguments.contains("--test-tone") { playTestTone() }
        else { control.async { [unowned self] in capture() } }
        dispatchMain()
    }

    /// On the control queue.
    private func capture() {
        guard !state.withLock({ finishing }) else { return }
        do { try install(TapSession.make(queue: control)) } catch { fail("\(error)") }
        let listener: AudioObjectPropertyListenerBlock = { [unowned self] count, addresses in
            if (0..<Int(count)).contains(where: { addresses[$0].mSelector == kAudioHardwarePropertyServiceRestarted }) {
                rebuild("the audio system restarted")
            } else if defaultOutput() != session?.device {
                rebuild("the default output device changed")
            }
        }
        self.listener = listener
        for selector in systemSelectors {
            var property = address(selector)
            AudioObjectAddPropertyListenerBlock(system, &property, control, listener)
        }
        // IO that stops for good (a device gone without a new default) is rebuilt rather than left silent.
        let timer = DispatchSource.makeTimerSource(queue: control)
        timer.schedule(deadline: .now() + 1, repeating: 0.5)
        timer.setEventHandler { [unowned self] in
            guard let session, !rebuilding else { return }
            let last = session.source.ring.lastWriteTime
            if last > 0, nanoseconds() - last > 1_500_000_000 { rebuild("the output device stopped delivering audio") }
        }
        timer.resume()
        watchdog = timer
    }

    /// `--test-tone`: a 440 Hz tone at 48 kHz, half scale, in place of the tap and delivered in 10 ms blocks like an
    /// IOProc, to check conversion, framing and shutdown without Core Audio or a permission.
    private func playTestTone() {
        let format = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                                                 mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
        let source = Source(format: format)
        state.withLock { writing = source }
        Thread {
            var block = [Float](repeating: 0, count: 480)
            var phase = 0.0
            let started = nanoseconds()
            var blocks: UInt64 = 0
            while true {
                for index in block.indices {
                    block[index] = Float(0.5 * sin(phase))
                    phase = (phase + 2 * Double.pi * 440 / 48_000).truncatingRemainder(dividingBy: 2 * Double.pi)
                }
                source.ring.write(block, block.count)
                blocks += 1
                let due = started + blocks * 10_000_000, now = nanoseconds()
                if due > now { usleep(UInt32((due - now) / 1_000)) }
            }
        }.start()
    }

    /// On the control queue.
    private func install(_ next: TapSession) throws {
        state.withLock { starting = true }
        defer { state.withLock { starting = false } }
        do { try next.start { [unowned self] reason in rebuild(reason) } } catch { next.destroy(); throw error }
        session = next
        state.withLock { writing = next.source }
    }

    /// On the control queue. Waits briefly so that a burst of device notifications rebuilds once, then retries for a
    /// few seconds while a device is still appearing.
    private func rebuild(_ reason: String, attempt: Int = 0) {
        if attempt == 0 {
            guard !rebuilding else { return }
            rebuilding = true
            control.asyncAfter(deadline: .now() + 0.3) { [unowned self] in rebuild(reason, attempt: 1) }
            return
        }
        guard !state.withLock({ finishing }) else { return }
        if attempt == 1 {
            note("rebuilding: \(reason)")
            state.withLock { writing = nil }
            session?.destroy()
            session = nil
        }
        do {
            try install(TapSession.make(queue: control))
            rebuilding = false
        } catch {
            let waits = [0.3, 1.0, 2.0, 4.0]
            guard attempt <= waits.count else { fail("it could not resume after \(reason): \(error)") }
            control.asyncAfter(deadline: .now() + waits[attempt - 1]) { [unowned self] in rebuild(reason, attempt: attempt + 1) }
        }
    }

    /// Converts what the IO thread delivered and writes whole frames to stdout. Runs on its own thread.
    private func write() {
        var current: Source?
        var converter: Converter?
        var scratch = [Float]()
        var pending = [Float]()
        pending.reserveCapacity(frameSamples * 8)
        while true {
            usleep(20_000)
            guard let source = state.withLock({ writing }) else { continue }
            if source !== current {
                current = source
                do { converter = try Converter(format: source.format, frames: Int(source.format.mSampleRate / 10)) } catch { abandon("\(error)") }
                scratch = [Float](repeating: 0, count: converter!.frames * source.channels)
            }
            guard let converter else { continue }
            while true {
                let count = scratch.withUnsafeMutableBufferPointer { source.ring.read(into: $0.baseAddress!, limit: $0.count) }
                if count == 0 { break }
                do {
                    try scratch.withUnsafeBufferPointer { samples in
                        try converter.convert(samples.baseAddress!, count: count / source.channels) { converted, total in
                            pending.append(contentsOf: UnsafeBufferPointer(start: converted, count: total))
                        }
                    }
                } catch { abandon("\(error)") }
            }
            while pending.count >= frameSamples {
                guard emit(pending[0..<frameSamples]) else { finish("stdout closed") }
                pending.removeFirst(frameSamples)
            }
        }
    }

    private func emit(_ frame: ArraySlice<Float>) -> Bool {
        let loudest = frame.reduce(Float(0)) { max($0, abs($1)) }
        state.withLock {
            frames += 1
            if loudest > 0 { audibleFrames += 1 }
            peak = max(peak, loudest)
        }
        return frame.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let written = Darwin.write(STDOUT_FILENO, bytes.baseAddress! + offset, bytes.count - offset)
                if written > 0 { offset += written } else if written < 0 && errno == EINTR { continue } else { return false }
            }
            return true
        }
    }

    /// A failure outside the control queue: releases the tap first.
    private func abandon(_ message: String) -> Never {
        _ = teardown()
        fail(message)
    }

    /// Stops IO and destroys the aggregate device and tap on the control queue, waiting at most 0.5 s: Core Audio can
    /// block that queue, and the system removes a private tap and aggregate device with the process that owns them.
    private func teardown() -> Bool {
        let done = DispatchSemaphore(value: 0)
        control.async { [unowned self] in
            watchdog?.cancel()
            if let listener {
                for selector in systemSelectors {
                    var property = address(selector)
                    AudioObjectRemovePropertyListenerBlock(system, &property, control, listener)
                }
                self.listener = nil
            }
            state.withLock { writing = nil }
            session?.destroy()
            session = nil
            done.signal()
        }
        return done.wait(timeout: .now() + 0.5) == .success
    }

    private func finish(_ reason: String) -> Never {
        let (first, blocked) = state.withLock { () -> (Bool, Bool) in
            defer { finishing = true }
            return (!finishing, starting)
        }
        guard first else { while true { pause() } }
        note("stopping: \(reason)")
        // AudioDeviceStart does not return while the macOS permission prompt is unanswered.
        if blocked { note("capture was still starting; the system removes its tap and aggregate device with this process"); _exit(0) }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.8) { _exit(0) }
        guard teardown() else { note("teardown did not finish; the system removes the tap and aggregate device with this process"); _exit(0) }
        state.withLock { note("wrote \(frames) frames, \(audibleFrames) with sound, peak \(peak)") }
        exit(0)
    }
}

if let unknown = CommandLine.arguments.dropFirst().first(where: { !["--verbose", "--test-tone"].contains($0) }) {
    fail("unknown option \(unknown)")
}
if #available(macOS 14.2, *) {
    CallAudio().run()
} else {
    fail("recording audio playing on this Mac needs macOS 14.2 or later")
}
