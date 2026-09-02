import ExpoModulesCore
import Foundation

#if canImport(HealthKit)
import HealthKit
#endif

/// The app's half of Apple Health, and deliberately the smallest half that
/// answers a question.
///
/// Everything here is read-only. Nothing writes a sample, nothing asks for
/// share access, and the entitlement plugin claims only the read half
/// (`plugins/withHealthKit.js`) — this app consults a number another app
/// recorded, it never records one.
///
/// Every function returns a value rather than Void, the same rule
/// TodoWidgetBridgeModule.swift states at length: RN's exception-to-JSError
/// conversion was fixed for `performMethodInvocation` and never extended to
/// `performVoidMethodInvocation`, so a Void-returning module method that raises
/// takes the app down instead of rejecting the promise. The bodies are wrapped
/// in TodoHealthExceptionCatcher on top of that, because Swift cannot catch a
/// raw NSException at all and HealthKit raises them.
///
/// **What this deliberately cannot do: tell you whether a read was allowed.**
/// `HKHealthStore.authorizationStatus(for:)` is truthful about *write* access
/// and answers `.notDetermined` for reads whatever the real answer is, so that
/// a refusal is indistinguishable from having no data — Apple's own words, and
/// the whole point of it. So there is no `isAuthorized` here to build a
/// permission UI on, and there never can be. What exists instead is
/// `authorizationRequestStatus`, which answers the one thing the system will
/// say: whether asking again would put a sheet on screen. Every read answers
/// `null` for "no number", and null means *no number* — refused, no data
/// recorded, or a device that never had any, with nothing to tell them apart.
///
/// **Every async function here settles its promise on every path, including the
/// one where the exception catcher swallows something.** Only the *start* of
/// each call is inside the catcher — the query's own completion handler runs
/// later, so an NSException raised while starting means that handler never
/// fires and the promise would hang for good. On the JS side that is worse than
/// an error: `useHealthStore.refresh` clears its `refreshing` flag in a
/// `finally`, so a promise that never settles wedges the store into "a read is
/// already running" until the app is killed. Hence the `started` flag each one
/// checks after the catcher returns.
public class TodoHealthBridgeModule: Module {
  #if canImport(HealthKit)
  /// One store for the module's life. `HKHealthStore` is documented as
  /// expensive to create and intended to be long-lived, and a per-call store
  /// would also lose the authorization request's own bookkeeping between the
  /// request and the read that follows it.
  private lazy var store = HKHealthStore()

  /// Every type this app will ever ask to read.
  ///
  /// One list rather than a per-call type, because the permission sheet is
  /// shown once for whatever is asked for and a second request for a type not
  /// in the first sheet is a second sheet. Step count is the only member today;
  /// a type added here is a type the sheet will list, so nothing goes in until
  /// something reads it.
  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    if let steps = HKQuantityType.quantityType(forIdentifier: .stepCount) {
      types.insert(steps)
    }
    return types
  }
  #endif

  public func definition() -> ModuleDefinition {
    Name("TodoHealthBridge")

    // ─── Availability and authorization ─────────────────────────────────────

    /// Whether this build, on this device, can do any of the rest of it.
    ///
    /// False on iPad and on a build without the framework. This is the "this
    /// phone can't" answer, which is a different thing from "you haven't said
    /// yes" and wants a different thing on screen — see `healthBridge.ts`.
    Function("isAvailable") { () -> Bool in
      #if canImport(HealthKit)
      var available = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        available = HKHealthStore.isHealthDataAvailable()
      }
      return available
      #else
      return false
      #endif
    }

    /// "unavailable" | "shouldRequest" | "unnecessary" | "unknown".
    ///
    /// The only thing HealthKit will say about read access, and note what it
    /// does *not* say: `unnecessary` means asking again would show no sheet,
    /// which happens both when everything was allowed and when everything was
    /// refused. It answers "have you been asked", never "were you allowed".
    /// Treat it as the difference between offering a button and not.
    ///
    /// Async because `getRequestStatusForAuthorization` is: the answer involves
    /// the health daemon, and there is no synchronous form of it.
    AsyncFunction("authorizationRequestStatus") { (promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve("unavailable")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.getRequestStatusForAuthorization(toShare: [], read: self.readTypes) { status, _ in
          switch status {
          case .shouldRequest: promise.resolve("shouldRequest")
          case .unnecessary: promise.resolve("unnecessary")
          case .unknown: promise.resolve("unknown")
          @unknown default: promise.resolve("unknown")
          }
        }
        started = true
      }
      if !started { promise.resolve("unknown") }
      #else
      promise.resolve("unavailable")
      #endif
    }

    /// Ask for read access, and report only whether the asking happened.
    ///
    /// "unavailable" | "requested" | "failed". Deliberately not "granted" or
    /// "denied": the completion handler's `success` flag means the sheet was
    /// presented and dismissed without error, and carries no information about
    /// what the user chose. A bridge that mapped it to "granted" would be
    /// inventing the one fact Apple withholds, and every screen built on that
    /// lie would be wrong for exactly the people who said no.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve("unavailable")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.requestAuthorization(toShare: [], read: self.readTypes) { success, _ in
          promise.resolve(success ? "requested" : "failed")
        }
        started = true
      }
      if !started { promise.resolve("failed") }
      #else
      promise.resolve("unavailable")
      #endif
    }

    // ─── Reading ────────────────────────────────────────────────────────────

    /// Total steps between two instants, as JSON: `{"steps":4120}` or
    /// `{"steps":null}`.
    ///
    /// A JSON string rather than a number because the answer is genuinely
    /// nullable and there is no honest sentinel: 0 is a real step count for a
    /// day spent in bed, and -1 is a magic number the JS side would have to
    /// remember. Same shape `drainCrossings` uses in the Screen Time bridge,
    /// and the parse lives on the TS side in one place.
    ///
    /// The window comes from JS rather than being computed here, because the
    /// day it should cover is the user's *logical* day and `dayResetTime` lives
    /// in the settings store. A native `startOfDay` would file a 1am reading
    /// against the wrong day for anyone whose day starts at 4am — the same
    /// mistake the Screen Time extension avoids by being handed a day key.
    AsyncFunction("readSteps") { (startISO: String, endISO: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            let type = HKQuantityType.quantityType(forIdentifier: .stepCount),
            let start = Self.parseISO(startISO),
            let end = Self.parseISO(endISO) else {
        promise.resolve("{\"steps\":null}")
        return
      }

      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        // `.separateBySource` on top of the sum because a phone and a watch
        // both record steps for the same walk, and HealthKit does not
        // de-duplicate them for a statistics query — the Health app's own
        // total is computed by logic Apple has never exposed. Summing every
        // source double-counts anyone wearing a Watch, which is most of the
        // people this is for. Taking the largest single source under-counts a
        // day split between devices, and that is the error to prefer: it never
        // claims more steps than some one device actually recorded, which is
        // the difference between a reading and a guess.
        let query = HKStatisticsQuery(
          quantityType: type,
          quantitySamplePredicate: predicate,
          options: [.cumulativeSum, .separateBySource]
        ) { _, statistics, _ in
          guard let statistics else {
            promise.resolve("{\"steps\":null}")
            return
          }
          var best: Double? = nil
          if let sources = statistics.sources, !sources.isEmpty {
            for source in sources {
              guard let quantity = statistics.sumQuantity(for: source) else { continue }
              let value = quantity.doubleValue(for: HKUnit.count())
              if best == nil || value > best! { best = value }
            }
          }
          if best == nil, let total = statistics.sumQuantity() {
            best = total.doubleValue(for: HKUnit.count())
          }
          guard let steps = best else {
            // No samples at all in the window. Indistinguishable from a read
            // that was refused, which is exactly why both answer null.
            promise.resolve("{\"steps\":null}")
            return
          }
          promise.resolve("{\"steps\":\(Int(steps.rounded()))}")
        }
        self.store.execute(query)
        started = true
      }
      if !started { promise.resolve("{\"steps\":null}") }
      #else
      promise.resolve("{\"steps\":null}")
      #endif
    }
  }

  /// Parse an instant written by JavaScript's `toISOString()`.
  ///
  /// Two formatters because `ISO8601DateFormatter` fails outright on a string
  /// whose fractional-seconds presence doesn't match its options, and
  /// `toISOString()` always writes them while a hand-built date might not.
  private static func parseISO(_ value: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: value) { return date }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: value)
  }
}
