// Runs in the owning process: private devices are invisible to system_profiler and other processes.
// It creates the tap and aggregate device without starting IO or recording sound.
@available(macOS 14.2, *)
extension TapSession {
    var objectsForTest: [AudioObjectID] { [aggregate, tap] }
}

func exists(_ id: AudioObjectID) -> Bool {
    var property = address(kAudioObjectPropertyClass)
    return AudioObjectHasProperty(id, &property)
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw Failure(description: message) }
}

if #available(macOS 14.2, *) {
    do {
        let queue = DispatchQueue(label: "my.memoria.call-audio.lifecycle-test")
        for attempt in 1...3 {
            let session = try TapSession.make(queue: queue)
            let objects = session.objectsForTest
            try require(objects.allSatisfy(exists), "tap and aggregate must exist before destroy()")
            session.destroy()
            // Core Audio invalidates its local property cache asynchronously.
            let deadline = Date().addingTimeInterval(1)
            while objects.contains(where: exists) && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.01))
            }
            for id in objects {
                try require(!exists(id), "audio object \(id) survived destroy()")
            }
            print("PASS lifecycle \(attempt): tap and aggregate released (verbose=\(verbose))")
        }
    } catch { fail("\(error)") }
} else {
    print("SKIP: Core Audio taps require macOS 14.2")
}
