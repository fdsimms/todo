import ExpoModulesCore
import MetricKit

// Collects the daily reports iOS builds about this app (how long it took to
// launch, how long it hung, peak memory, CPU time) and hands them to JS as
// the raw JSON MetricKit itself writes. Nothing here reads a metric by name:
// every typed accessor is a signature that cannot be compiled from the
// sandbox this was written in, and the JSON is what MetricKit documents as
// its portable form. src/utils/metricKit.ts does the reading, and says so
// when it cannot read a payload instead of guessing.
//
// MXMetricManager and its subscriber protocol are deprecated from iOS 27.2 in
// favour of MetricManager, which is iOS 27+ only (the app's deployment target
// is 15.1) and delivers through async sequences. The old API still works on
// every version the app supports, so this uses it; moving to the new one is a
// separate change that needs `#available` and a device to check it on.
//
// Reports arrive about once a day, only to builds installed on a device
// (never the simulator), and only for the past 24 hours of use.

// Held for the life of the process: MetricKit keeps a reference to a
// subscriber but a subscriber that is released stops receiving.
private final class TodoMetricKitSubscriber: NSObject, MXMetricManagerSubscriber {
  private let lock = NSLock()
  private var started = false
  private var received: [String] = []

  func start() {
    lock.lock()
    defer { lock.unlock() }
    if started { return }
    started = true
    MXMetricManager.shared.add(self)
  }

  // Reports delivered since the process started. The ones delivered before
  // that are `pastPayloads`, read in `allPayloads`.
  func didReceive(_ payloads: [MXMetricPayload]) {
    let strings = payloads.compactMap { String(data: $0.jsonRepresentation(), encoding: .utf8) }
    lock.lock()
    received.append(contentsOf: strings)
    // Bounded: a long-lived process gets one a day, and JS keeps what it needs.
    if received.count > 20 { received.removeFirst(received.count - 20) }
    lock.unlock()
  }

  // Required by the protocol on some SDKs and ignored here: diagnostics are
  // crash and hang stacks, which this app has no use for and would have to
  // keep out of anything a person copies.
  func didReceive(_ payloads: [MXDiagnosticPayload]) {}

  func allPayloads() -> [String] {
    let past = MXMetricManager.shared.pastPayloads.compactMap {
      String(data: $0.jsonRepresentation(), encoding: .utf8)
    }
    lock.lock()
    let now = received
    lock.unlock()
    // The same report can be in both; JS drops the repeat by its time range.
    return past + now
  }
}

private let sharedSubscriber = TodoMetricKitSubscriber()

public class TodoMetricKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoMetricKit")

    // Synchronous, like the other bridges' isAvailable: a capability check
    // callers branch on before doing anything else.
    Function("isAvailable") { () -> Bool in
      return true
    }

    // Idempotent. Called as early in launch as JS can, because MetricKit hands
    // over reports that arrived while the app was closed shortly after a
    // subscriber is added.
    // Returns true rather than nothing: the same shape `clearSelection` in
    // the Screen Time bridge uses, which is known to compile here.
    Function("start") { () -> Bool in
      sharedSubscriber.start()
      return true
    }

    // Plain strings, the least fragile thing to send across the boundary.
    Function("payloads") { () -> [String] in
      return sharedSubscriber.allPayloads()
    }
  }
}
