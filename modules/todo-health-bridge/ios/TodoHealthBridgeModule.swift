import ExpoModulesCore
import Foundation

#if canImport(HealthKit)
import HealthKit
#endif

/// The app's half of Apple Health, and deliberately the smallest half that
/// answers a question.
///
/// Almost everything here is still read-only: this app consults a number
/// another app recorded for steps, sleep and eight nutrients, and never
/// records any of them. The exceptions are a handful of writes — a nutrient,
/// logged when a task that opted into it completes (`writeNutrientSample`
/// below, `healthCompletionSync.ts` on the JS side), a logged meal
/// (`writeFoodSamples`), and a body-mass sample — which are a deliberately
/// separate ask (`writeTypes`, its own authorization functions) from
/// everything the read half does, so reading steps never puts a share
/// permission on screen for somebody who never asked to write anything. See
/// `docs/arch/health-data.md` for why these are the types that earned a
/// write path.
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
/// **The write side is the mirror of that, and genuinely can say whether it
/// was allowed.** `authorizationStatus(for:)` is truthful for share/write
/// types — that's the same call, the obscuring is specific to reads — so
/// `writeAuthorizationStatus` below is a plain, synchronous, honest answer:
/// not determined, denied, or authorized. Nothing about this file's read-side
/// limitation applies to it.
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
  /// in the first sheet is a second sheet. A type added here is a type the
  /// sheet will list, so nothing goes in until something reads it.
  ///
  /// **Adding one is not free for people already using the feature.** The app
  /// never re-prompts on its own (a sweep must not raise this sheet), so an
  /// install that allowed steps before sleep was added simply gets no sleep
  /// until somebody taps the access row in Settings — and, because a refused
  /// read and an unasked one look identical from here, nothing can tell them
  /// that is why. Weigh that against what the type buys before extending this.
  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    if let steps = HKQuantityType.quantityType(forIdentifier: .stepCount) {
      types.insert(steps)
    }
    if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
      types.insert(sleep)
    }
    if let sodium = HKQuantityType.quantityType(forIdentifier: .dietarySodium) {
      types.insert(sodium)
    }
    if let protein = HKQuantityType.quantityType(forIdentifier: .dietaryProtein) {
      types.insert(protein)
    }
    if let satFat = HKQuantityType.quantityType(forIdentifier: .dietaryFatSaturated) {
      types.insert(satFat)
    }
    if let fiber = HKQuantityType.quantityType(forIdentifier: .dietaryFiber) {
      types.insert(fiber)
    }
    if let sugar = HKQuantityType.quantityType(forIdentifier: .dietarySugar) {
      types.insert(sugar)
    }
    if let caffeine = HKQuantityType.quantityType(forIdentifier: .dietaryCaffeine) {
      types.insert(caffeine)
    }
    if let water = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
      types.insert(water)
    }
    if let energy = HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed) {
      types.insert(energy)
    }
    if let bodyMass = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
      types.insert(bodyMass)
    }
    return types
  }

  /// Every type this app will ever ask to *write* — two, today. Deliberately
  /// its own set rather than folded into `readTypes`: a share type is a real
  /// consequence (a sample landing in somebody's actual Health record) that a
  /// read type isn't, so it's requested on its own (see `requestWriteAuthorization`)
  /// rather than riding along with whatever's being read.
  ///
  /// Body mass is the second, and it earned its own review the way the note
  /// here has always said a second type would have to. What licensed it is the
  /// same thing that licensed reading the eight nutrients: a weight exists at
  /// all only because a person stepped on a scale or typed it in, so recording
  /// one is writing down their number rather than the app forming an opinion
  /// about a body. The guardrail that replaces "there is only one write type"
  /// is that nothing *derives* anything from it — no rule metric, no generated
  /// task, no BMI, no verdict against a goal. See `docs/arch/health-data.md`.
  private var writeTypes: Set<HKSampleType> {
    var types = Set<HKSampleType>()
    if let water = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
      types.insert(water)
    }
    if let bodyMass = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
      types.insert(bodyMass)
    }
    for entry in Self.nutrientWriteTable {
      if let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) {
        types.insert(type)
      }
    }
    return types
  }

  /// Every nutrient a logged meal writes, with the identifier and unit each one
  /// is recorded in. The keys are `NutrientKey` from `src/types/index.ts`, so a
  /// figure crosses the bridge under the same name it has on both sides.
  ///
  /// **Ten, not the eight `readTypes` collects.** Carbohydrate and total fat
  /// are written but never read: nothing in this app watches them, no rule
  /// fires on them, and no screen shows them from Health. They are here because
  /// the consumer isn't this app — a meal that reaches the Health app with no
  /// carbohydrate line reads as incomplete rather than as deliberate, and every
  /// other app reading this record expects the macros together. That is a
  /// decision made out loud rather than by whatever the write loop happened to
  /// iterate over; see `docs/arch/health-data.md`.
  ///
  /// The units are each nutrient's own, matching what `NutrientKey`'s name
  /// already says it stores — the JS side does no conversion on the way here,
  /// because `nutritionParse.ts` already did it once and a second opinion about
  /// units in a second language is how a sodium figure lands a thousand times
  /// too high.
  private static let nutrientWriteTable: [(key: String, identifier: HKQuantityTypeIdentifier, unit: HKUnit)] = [
    ("calorieKcal", .dietaryEnergyConsumed, HKUnit.kilocalorie()),
    ("proteinG", .dietaryProtein, HKUnit.gram()),
    ("carbsG", .dietaryCarbohydrates, HKUnit.gram()),
    ("fatG", .dietaryFatTotal, HKUnit.gram()),
    ("satFatG", .dietaryFatSaturated, HKUnit.gram()),
    ("fiberG", .dietaryFiber, HKUnit.gram()),
    ("sugarG", .dietarySugar, HKUnit.gram()),
    ("sodiumMg", .dietarySodium, HKUnit.gramUnit(with: .milli)),
    ("caffeineMg", .dietaryCaffeine, HKUnit.gramUnit(with: .milli)),
    ("waterMl", .dietaryWater, HKUnit.literUnit(with: .milli)),
  ]

  /// The share type a write-side call is asking about, resolved from the key
  /// the JS side passes.
  ///
  /// A key rather than a second copy of each write function, because
  /// `authorizationStatus(for:)` is per-type and the settings screen has to be
  /// able to say "water: allowed, weight: not asked" separately — the two
  /// permissions are genuinely independent in Health, and a single status for
  /// "writing" would be a lie as soon as somebody allowed one and refused the
  /// other.
  ///
  /// A list rather than one type, because `"nutrition"` is ten of them: a meal
  /// is written as one correlation of ten samples, and Health asks about each
  /// share type separately inside that one sheet. What the settings row does
  /// with ten answers is `writeAuthorizationStatus`'s problem, not this one's.
  private static func writeTypes(for key: String) -> [HKQuantityType] {
    switch key {
    case "water":
      return [HKQuantityType.quantityType(forIdentifier: .dietaryWater)].compactMap { $0 }
    case "weight":
      return [HKQuantityType.quantityType(forIdentifier: .bodyMass)].compactMap { $0 }
    case "nutrition":
      return nutrientWriteTable.compactMap { HKQuantityType.quantityType(forIdentifier: $0.identifier) }
    default:
      return []
    }
  }

  /// The total to report for one statistics bucket, in `unit`, or nil for no
  /// samples.
  ///
  /// `.separateBySource` on top of the sum because two sources can both record
  /// the same real-world thing — a phone and a watch both counting steps for
  /// one walk, or two food-logging apps both writing the same meal's sodium —
  /// and HealthKit does not de-duplicate for a statistics query. Summing every
  /// source double-counts whichever of those applies to a given person.
  /// Taking the largest single source under-counts a day split across devices
  /// or apps instead, and that is the error to prefer: it never claims more
  /// than some one source actually recorded, which is the difference between a
  /// reading and a guess.
  ///
  /// Shared by every cumulative quantity this reads (steps and the eight
  /// nutrients) so the rule cannot drift between them, which is the whole
  /// reason it is a function rather than being written out at each call site.
  private static func bestSum(_ statistics: HKStatistics, unit: HKUnit) -> Double? {
    var best: Double? = nil
    if let sources = statistics.sources, !sources.isEmpty {
      for source in sources {
        guard let quantity = statistics.sumQuantity(for: source) else { continue }
        let value = quantity.doubleValue(for: unit)
        if best == nil || value > best! { best = value }
      }
    }
    if best == nil, let total = statistics.sumQuantity() {
      best = total.doubleValue(for: unit)
    }
    return best
  }

  /// One `HKStatisticsCollectionQuery` over `identifier`, bucketed the same
  /// way steps and sodium already were, writing each day's `bestSum` through
  /// `write` and calling `finish` when the query's own callback fires.
  ///
  /// Pulled out once a fourth cumulative quantity (saturated fat) would have
  /// made this the fourth near-identical fifteen-line block in this
  /// function — same predicate, same options, same anchor, differing only in
  /// which identifier and unit feed `bestSum` and which array the result
  /// lands in. `write` closes over that array directly rather than this
  /// taking an `inout` parameter, because an `inout` can't survive across the
  /// query's own escaping completion handler.
  private func runDietQuery(
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    anchor: Date,
    end: Date,
    starts: [Date],
    write: @escaping (Int, Double) -> Void,
    finish: @escaping () -> Void
  ) {
    guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
      finish()
      return
    }
    let query = HKStatisticsCollectionQuery(
      quantityType: type,
      quantitySamplePredicate: HKQuery.predicateForSamples(
        withStart: anchor, end: end, options: .strictStartDate
      ),
      options: [.cumulativeSum, .separateBySource],
      anchorDate: anchor,
      intervalComponents: DateComponents(day: 1)
    )
    query.initialResultsHandler = { _, collection, _ in
      collection?.enumerateStatistics(from: anchor, to: end) { statistics, _ in
        // Which bucket a result falls *in*, rather than which bucket start it
        // equals. The enumeration is anchored to the same instants `starts`
        // was built from, so the two should match exactly — but "should" here
        // means every day silently reads null if they ever don't, and a
        // feature whose absent value is indistinguishable from a refusal
        // cannot afford a failure that looks like no data. Same containment
        // rule the sleep query below uses.
        guard let i = starts.lastIndex(where: { $0 <= statistics.startDate }) else { return }
        if let value = Self.bestSum(statistics, unit: unit) { write(i, value) }
      }
      finish()
    }
    self.store.execute(query)
  }

  /// The category values that count as asleep.
  ///
  /// Raw numbers rather than the `HKCategoryValueSleepAnalysis` cases because
  /// the granular ones (`asleepCore`, `asleepDeep`, `asleepREM`) are iOS 16 and
  /// this pod's floor is 15.1 — matching on the values avoids an availability
  /// dance for a set that has not changed. `inBed` (0) and `awake` (2) are
  /// deliberately out: time in bed is not sleep, and counting it would inflate
  /// the number for exactly the people who track most carefully.
  private static let asleepValues: Set<Int> = [1, 3, 4, 5]
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

    // ─── Writing (dietary water and body mass) ─────────────────────────────

    /// "unavailable" | "notDetermined" | "sharingDenied" | "sharingAuthorized",
    /// for the one share type named by `kind` ("water" | "weight").
    ///
    /// The write mirror of `authorizationRequestStatus` above, and able to say
    /// something that one structurally cannot: `authorizationStatus(for:)` is
    /// truthful for share/write types (Apple's own docs draw this exact line),
    /// so this reports what actually happened rather than only whether asking
    /// again would show a sheet. Synchronous, since there is no daemon round
    /// trip needed for a fact HealthKit already holds locally.
    ///
    /// Per type rather than one answer for "writing", because Health lets
    /// somebody allow water and refuse weight in the same sheet, and a settings
    /// row that reported one status for both would tell half of those people
    /// something false.
    Function("writeAuthorizationStatus") { (kind: String) -> String in
      #if canImport(HealthKit)
      let types = Self.writeTypes(for: kind)
      guard HKHealthStore.isHealthDataAvailable(), !types.isEmpty else {
        return "unavailable"
      }
      var resolved = false
      // The weakest answer across the types wins, which matters only for
      // `"nutrition"` and is the same "never claim more than is true" call
      // `bestSum` makes on the read side. Somebody who allowed nine nutrients
      // and refused sugar has a row that should send them to the Health app,
      // not one saying "Allowed" over a meal that will land incomplete.
      var denied = false
      var undetermined = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        for type in types {
          switch self.store.authorizationStatus(for: type) {
          case .sharingDenied: denied = true
          case .notDetermined: undetermined = true
          case .sharingAuthorized: break
          @unknown default: undetermined = true
          }
        }
        resolved = true
      }
      if !resolved { return "unavailable" }
      if denied { return "sharingDenied" }
      if undetermined { return "notDetermined" }
      return "sharingAuthorized"
      #else
      return "unavailable"
      #endif
    }

    /// Ask for water-write access. Same "unavailable" | "requested" | "failed"
    /// shape as `requestAuthorization`, and the same reason it says no more
    /// than that the sheet was shown — but unlike the read side, a caller that
    /// wants the truth can simply call `writeAuthorizationStatus` right after
    /// this resolves, rather than being stuck with "requested" forever.
    /// `toShare: writeTypes, read: []` on purpose: this never asks to read
    /// anything, so it can be triggered on its own from a task's water-logging
    /// row without also raising the unrelated steps/sleep/nutrient read sheet.
    AsyncFunction("requestWriteAuthorization") { (promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve("unavailable")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.requestAuthorization(toShare: self.writeTypes, read: []) { success, _ in
          promise.resolve(success ? "requested" : "failed")
        }
        started = true
      }
      if !started { promise.resolve("failed") }
      #else
      promise.resolve("unavailable")
      #endif
    }

    /// Writes one sample of `amount`, in `key`'s own unit, dated now.
    ///
    /// `key` resolves against `nutrientWriteTable` — the same table
    /// `writeFoodSamples` below writes under, so a task logging (say)
    /// `"waterMl"` this way lands under the identical share type a food log
    /// entry stating water would. This is the generalization of what used to
    /// be a water-only `writeWaterSample`: every nutrient already had a share
    /// type from the food-log write, so a task naming one needed only this
    /// single-sample write next to the ten-sample one, not a second table.
    ///
    /// One-shot, like a completion-calendar event: there is no update or
    /// delete counterpart, because a logged amount is a historical record the
    /// same way a calendar event logging a completion is (see
    /// `completionCalendarSync.ts`). Resolves `false` for every reason there
    /// is nothing to report success for: no native half, an unrecognized key,
    /// a non-positive amount, not authorized, or the save itself failing —
    /// the caller (`healthCompletionSync.ts`) treats all of them alike, since
    /// none of them warrant surfacing an error to someone who just finished a
    /// task.
    AsyncFunction("writeNutrientSample") { (key: String, amount: Double, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(), amount > 0, amount.isFinite,
            let entry = Self.nutrientWriteTable.first(where: { $0.key == key }),
            let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) else {
        promise.resolve(false)
        return
      }
      let quantity = HKQuantity(unit: entry.unit, doubleValue: amount)
      let now = Date()
      let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.save(sample) { success, _ in
          promise.resolve(success)
        }
        started = true
      }
      if !started { promise.resolve(false) }
      #else
      promise.resolve(false)
      #endif
    }

    /// Writes one body-mass sample of `kilograms`, dated `whenISO`.
    ///
    /// Takes its date rather than stamping `Date()` the way `writeNutrientSample`
    /// does, and that difference is the feature: a glass of water is logged by
    /// finishing a task, so the moment it happens *is* now, while a weight is
    /// typed in by somebody who may well be entering this morning's reading in
    /// the evening. An unparseable date falls back to now rather than refusing,
    /// since a weight filed at the wrong hour of the right day is worth more
    /// than no weight at all.
    ///
    /// Same one-shot shape as the water write: no update, no delete, no id kept.
    /// Health is the record, and correcting a weight is something the Health app
    /// itself does better than a mirror of it here would.
    ///
    /// The ceiling is an absurdity check, not a judgement — it exists so a
    /// mistyped "725" can't put a permanent outlier in somebody's medical
    /// record, and it sits far above any real body mass so it can never be the
    /// thing that refuses a genuine reading.
    AsyncFunction("writeBodyMassSample") { (kilograms: Double, whenISO: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            kilograms > 0, kilograms < 1000, kilograms.isFinite,
            let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
        promise.resolve(false)
        return
      }
      let quantity = HKQuantity(unit: HKUnit.gramUnit(with: .kilo), doubleValue: kilograms)
      let when = Self.parseISO(whenISO) ?? Date()
      let sample = HKQuantitySample(type: type, quantity: quantity, start: when, end: when)
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.save(sample) { success, _ in
          promise.resolve(success)
        }
        started = true
      }
      if !started { promise.resolve(false) }
      #else
      promise.resolve(false)
      #endif
    }

    /// Writes one logged meal as an `HKCorrelation` of type `.food`, and
    /// resolves the UUIDs of everything it saved as a JSON array of strings.
    ///
    /// `amountsJSON` is a `{"proteinG": 12.4, …}` object keyed by
    /// `NutrientKey`, carrying only the figures the entry actually states.
    /// **A nutrient absent from it is not written**, and that is the whole
    /// contract rather than an optimisation: absent means the label never said,
    /// and a zero sample would be this app claiming on somebody's behalf that a
    /// meal contained none of something nobody measured. A figure that *is*
    /// present and zero is written, because "no fat" is a real thing for a
    /// label to state. See `FoodNutrition.amounts`.
    ///
    /// **A correlation rather than ten loose samples**, because a meal is one
    /// thing. Saved loose they appear in the Health app as ten unrelated
    /// numbers at 12:47; correlated they appear as the meal, named by
    /// `HKMetadataKeyFoodType`, with its figures underneath.
    ///
    /// **The UUIDs are the point of this function.** `writeNutrientSample` and
    /// `writeBodyMassSample` return a bare `Bool` and keep nothing, because
    /// Health is the record and neither has an edit path here. A food log does:
    /// an entry deleted must retract what it wrote, or a mistyped meal is a
    /// permanent false fact in a medical record that nobody would know to go
    /// looking for. So the saved objects' identifiers come back and are stored
    /// on `FoodLogEntry.healthSampleIds`.
    ///
    /// The correlation's own UUID is returned alongside its members'. Deleting
    /// the correlation is what actually retracts the meal; the members are
    /// carried so a partial save still leaves something to clean up.
    ///
    /// Resolves `"[]"` for every reason there is nothing to report: no native
    /// half, no readable amounts, no correlation type, or the save failing.
    /// The caller treats them alike — an entry with no sample ids simply has
    /// nothing to retract later.
    AsyncFunction("writeFoodSamples") { (label: String, atISO: String, amountsJSON: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            let correlationType = HKObjectType.correlationType(forIdentifier: .food),
            let data = amountsJSON.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        promise.resolve("[]")
        return
      }

      let when = Self.parseISO(atISO) ?? Date()
      var samples = Set<HKSample>()
      for entry in Self.nutrientWriteTable {
        // `as? Double` alone would drop a whole number, which JSONSerialization
        // hands back as an NSNumber that bridges to Int — and a meal stating
        // "12g protein" is the ordinary case, not an edge one.
        guard let number = parsed[entry.key] as? NSNumber else { continue }
        let value = number.doubleValue
        guard value.isFinite, value >= 0,
              let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) else { continue }
        let quantity = HKQuantity(unit: entry.unit, doubleValue: value)
        samples.insert(HKQuantitySample(type: type, quantity: quantity, start: when, end: when))
      }
      guard !samples.isEmpty else {
        promise.resolve("[]")
        return
      }

      let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
      let metadata: [String: Any]? = trimmed.isEmpty ? nil : [HKMetadataKeyFoodType: trimmed]
      let meal = HKCorrelation(
        type: correlationType,
        start: when,
        end: when,
        objects: samples,
        metadata: metadata
      )

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.save(meal) { success, _ in
          guard success else {
            promise.resolve("[]")
            return
          }
          var ids = [meal.uuid.uuidString]
          ids.append(contentsOf: samples.map { $0.uuid.uuidString })
          let encoded = (try? JSONSerialization.data(withJSONObject: ids))
            .flatMap { String(data: $0, encoding: .utf8) }
          promise.resolve(encoded ?? "[]")
        }
        started = true
      }
      if !started { promise.resolve("[]") }
      #else
      promise.resolve("[]")
      #endif
    }

    /// Deletes the samples named by `idsJSON`, a JSON array of UUID strings.
    ///
    /// The retraction half of `writeFoodSamples`, and the first delete this
    /// bridge has ever had. HealthKit only lets an app delete what it itself
    /// saved, which is the guarantee that makes this safe to expose at all: no
    /// argument to this function can reach a sample somebody's scale or another
    /// food app wrote.
    ///
    /// Deletes per type rather than by fetching the objects first, because
    /// `deleteObjects(of:predicate:)` matches on the same UUIDs without a round
    /// trip and without needing the objects to still be readable. The
    /// correlation type is included alongside the ten quantity types, since the
    /// correlation is its own object and deleting only its members would leave
    /// an empty meal in the Health app.
    ///
    /// Resolves true when nothing went wrong, including when the ids matched
    /// nothing — an entry deleted twice, or one whose samples the person
    /// already removed in the Health app, is not a failure to report.
    AsyncFunction("deleteHealthSamples") { (idsJSON: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            let data = idsJSON.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String] else {
        promise.resolve(false)
        return
      }
      let uuids = Set(raw.compactMap { UUID(uuidString: $0) })
      guard !uuids.isEmpty else {
        promise.resolve(true)
        return
      }

      var types: [HKObjectType] = Self.nutrientWriteTable.compactMap {
        HKQuantityType.quantityType(forIdentifier: $0.identifier)
      }
      if let correlationType = HKObjectType.correlationType(forIdentifier: .food) {
        types.append(correlationType)
      }
      guard !types.isEmpty else {
        promise.resolve(false)
        return
      }

      let predicate = HKQuery.predicateForObjects(with: uuids)
      // Eleven deletes report back on arbitrary background queues, so the
      // tally is kept on a serial queue of its own rather than touched from
      // whichever thread finished — the same treatment `readDailyHealth`'s own
      // fan-out gets, and needed more sharply here: getting the count wrong
      // means telling the app a retraction succeeded when it did not, and the
      // thing left behind is a sample in somebody's medical record.
      let tally = DispatchQueue(label: "TodoHealthBridge.deleteHealthSamples")
      var remaining = types.count
      var allSucceeded = true
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        for type in types {
          self.store.deleteObjects(of: type, predicate: predicate) { success, _, error in
            tally.async {
              // "No objects matched" is reported as a failure by HealthKit and
              // is not one here: a type this meal never wrote is the ordinary
              // case, since a given entry states some of the ten, not all.
              if !success, (error as NSError?)?.code != HKError.errorNoData.rawValue {
                allSucceeded = false
              }
              remaining -= 1
              if remaining == 0 { promise.resolve(allSucceeded) }
            }
          }
        }
        started = true
      }
      if !started { promise.resolve(false) }
      #else
      promise.resolve(false)
      #endif
    }

    // ─── Reading ────────────────────────────────────────────────────────────

    /// One entry per logical day, as JSON:
    /// `[{"start":"…","steps":4120,"sleepMinutes":437,"sodiumMg":1850,
    /// "proteinG":42,"satFatG":18,"fiberG":22,"sugarG":35,"caffeineMg":180,
    /// "waterMl":1900,"calorieKcal":2100}, …]`, any number null.
    ///
    /// The window is described as an anchor plus a day count rather than as a
    /// list of boundaries, because a logical day is exactly 1 calendar day long
    /// under any reset time — so `Calendar` can walk them from the anchor, and
    /// a DST day comes out 23 or 25 hours the way it should. What the anchor
    /// itself is stays JS's business: `dayResetTime` lives in the settings
    /// store, and nothing native may guess it (a native `startOfDay` would file
    /// a 1am reading against the wrong day for anyone whose day starts at 4am).
    ///
    /// Each entry carries its bucket's start instant, not a day key. The key is
    /// derived on the JS side from the same `getLogicalDayKey` every other
    /// reader uses, so there is exactly one implementation of "which day is
    /// this" in the app and it is the one with the setting.
    ///
    /// All ten numbers are nullable per day and null is not zero — a day
    /// with no samples, a day before the phone was set up, and a day whose
    /// type was refused all read the same way. See the module note above.
    AsyncFunction("readDailyHealth") { (anchorISO: String, days: Int, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(),
            days > 0, days <= 400,
            let anchor = Self.parseISO(anchorISO),
            let end = calendar.date(byAdding: .day, value: days, to: anchor) else {
        promise.resolve("[]")
        return
      }

      // The bucket boundaries, walked with the calendar so a DST day is 23 or
      // 25 hours rather than a hardcoded 86,400 seconds.
      var starts: [Date] = []
      for offset in 0..<days {
        guard let day = calendar.date(byAdding: .day, value: offset, to: anchor) else { break }
        starts.append(day)
      }
      guard starts.count == days else {
        promise.resolve("[]")
        return
      }

      var steps = [Double?](repeating: nil, count: days)
      var sleepMinutes = [Double?](repeating: nil, count: days)
      var sodiumMg = [Double?](repeating: nil, count: days)
      var proteinG = [Double?](repeating: nil, count: days)
      var satFatG = [Double?](repeating: nil, count: days)
      var fiberG = [Double?](repeating: nil, count: days)
      var sugarG = [Double?](repeating: nil, count: days)
      var caffeineMg = [Double?](repeating: nil, count: days)
      var waterMl = [Double?](repeating: nil, count: days)
      var calorieKcal = [Double?](repeating: nil, count: days)
      // Ten queries, one promise. `resolve` is called by whichever finishes
      // last, and `pending` is only ever touched on the health store's own
      // serial callback queue, so the count needs no lock.
      // The ten queries report back on arbitrary background queues, so the
      // countdown runs on a serial queue of its own rather than on whichever
      // thread finished. It does two jobs and both are needed: the decrements
      // cannot interleave (a lost one leaves the promise unresolved for ever,
      // which reads as Health simply never answering, and a doubled one
      // resolves it twice), and every per-day array written before a query's
      // own `finish` is enqueued is therefore visible to the final block that
      // reads all ten. Each array has exactly one writer, so this is the whole
      // of the sharing.
      let tally = DispatchQueue(label: "TodoHealthBridge.readDailyHealth")
      var pending = 10
      let finish = {
        tally.async {
          pending -= 1
          guard pending == 0 else { return }
          let entries: [String] = (0..<days).map { i in
            let part: (Double?) -> String = { $0.map { "\(Int($0.rounded()))" } ?? "null" }
            return "{\"start\":\"\(Self.formatISO(starts[i]))\",\"steps\":\(part(steps[i])),"
              + "\"sleepMinutes\":\(part(sleepMinutes[i])),\"sodiumMg\":\(part(sodiumMg[i])),"
              + "\"proteinG\":\(part(proteinG[i])),\"satFatG\":\(part(satFatG[i])),\"fiberG\":\(part(fiberG[i])),"
              + "\"sugarG\":\(part(sugarG[i])),\"caffeineMg\":\(part(caffeineMg[i])),\"waterMl\":\(part(waterMl[i])),"
              + "\"calorieKcal\":\(part(calorieKcal[i]))}"
          }
          promise.resolve("[" + entries.joined(separator: ",") + "]")
        }
      }

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        // ─── Steps and nine nutrients: one collection query each, over the
        // whole span ─────────────────────────────────────────────────────────
        //
        // A collection query rather than one statistics query per day, which
        // is what an anchor-plus-interval window is for: 90 round trips to the
        // health daemon to draw one insight is the version of this that gets
        // noticed. All ten are cumulative and per-source for the same reason:
        // a phone and a watch both counting steps for one walk, or two
        // food-logging apps both writing the same meal's sodium, would
        // otherwise be double-counted — see `bestSum`. This app never writes
        // any of the nine nutrients itself, so every number here came from
        // whatever food-logging app the person already uses.
        self.runDietQuery(
          identifier: .stepCount, unit: .count(), anchor: anchor, end: end, starts: starts,
          write: { i, value in steps[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietarySodium, unit: HKUnit.gramUnit(with: .milli), anchor: anchor, end: end, starts: starts,
          write: { i, value in sodiumMg[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryProtein, unit: .gram(), anchor: anchor, end: end, starts: starts,
          write: { i, value in proteinG[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryFatSaturated, unit: .gram(), anchor: anchor, end: end, starts: starts,
          write: { i, value in satFatG[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryFiber, unit: .gram(), anchor: anchor, end: end, starts: starts,
          write: { i, value in fiberG[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietarySugar, unit: .gram(), anchor: anchor, end: end, starts: starts,
          write: { i, value in sugarG[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryCaffeine, unit: HKUnit.gramUnit(with: .milli), anchor: anchor, end: end, starts: starts,
          write: { i, value in caffeineMg[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryWater, unit: HKUnit.literUnit(with: .milli), anchor: anchor, end: end, starts: starts,
          write: { i, value in waterMl[i] = value }, finish: finish
        )
        self.runDietQuery(
          identifier: .dietaryEnergyConsumed, unit: .kilocalorie(), anchor: anchor, end: end, starts: starts,
          write: { i, value in calorieKcal[i] = value }, finish: finish
        )

        // ─── Sleep: one sample query, bucketed here ────────────────────────
        //
        // There is no statistics query for a category type, so this is the one
        // metric the app has to bucket itself. A night is filed under the day
        // it *ends* in, which is how "I slept badly on Tuesday" is meant when
        // the sleeping happened on Monday night. A daytime nap therefore counts
        // toward its own day, which is why nothing calls this number "last
        // night": it is time asleep recorded against a day.
        if let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
          let query = HKSampleQuery(
            sampleType: type,
            predicate: HKQuery.predicateForSamples(withStart: anchor, end: end, options: []),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
          ) { _, samples, _ in
            // Per source, then the largest, for `bestSum`'s reason and a
            // sharper version of it: a phone recording "in bed" and a watch
            // recording stages overlap for the same night, so adding them puts
            // people to sleep twice.
            //
            // A night is not one sample: a Watch records a fresh
            // `HKCategorySample` every time the sleep stage changes, often
            // every few minutes, and every one of those crosses whatever
            // instant `dayResetTime` falls on the moment someone is still
            // asleep at that hour — which is most nights, not an edge case.
            // Bucketing each sample by its own `endDate` split a single
            // night's total across the two adjacent days instead of filing
            // the whole night under the day it ends in, undercounting both.
            // So samples are grouped into episodes per source first — a gap
            // longer than an hour between two samples means the night
            // actually ended (and a nap started later) — and each episode's
            // full duration is filed under the day its *last* sample ends in.
            let episodeGapSeconds: TimeInterval = 60 * 60
            var bySource: [String: [HKCategorySample]] = [:]
            for sample in (samples as? [HKCategorySample]) ?? [] {
              guard Self.asleepValues.contains(sample.value),
                    sample.endDate.timeIntervalSince(sample.startDate) > 0 else { continue }
              let key = sample.sourceRevision.source.bundleIdentifier
              bySource[key, default: []].append(sample)
            }
            var perDayBySource: [String: [Double]] = [:]
            for (source, sourceSamples) in bySource {
              var perDay = [Double](repeating: 0, count: days)
              var episodeMinutes: Double = 0
              var episodeEnd: Date?
              func flushEpisode() {
                defer {
                  episodeMinutes = 0
                  episodeEnd = nil
                }
                guard episodeMinutes > 0, let end = episodeEnd,
                      let i = starts.lastIndex(where: { $0 <= end }), i < days else { return }
                perDay[i] += episodeMinutes
              }
              for sample in sourceSamples.sorted(by: { $0.startDate < $1.startDate }) {
                if let prevEnd = episodeEnd,
                   sample.startDate.timeIntervalSince(prevEnd) > episodeGapSeconds {
                  flushEpisode()
                }
                episodeMinutes += sample.endDate.timeIntervalSince(sample.startDate) / 60
                episodeEnd = max(episodeEnd ?? sample.endDate, sample.endDate)
              }
              flushEpisode()
              perDayBySource[source] = perDay
            }
            for (_, perDay) in perDayBySource {
              for i in 0..<days where perDay[i] > 0 {
                if sleepMinutes[i] == nil || perDay[i] > sleepMinutes[i]! {
                  sleepMinutes[i] = perDay[i]
                }
              }
            }
            finish()
          }
          self.store.execute(query)
        } else {
          finish()
        }
        started = true
      }
      if !started { promise.resolve("[]") }
      #else
      promise.resolve("[]")
      #endif
    }

    /// One entry per logical day, as JSON:
    /// `[{"start":"…","grams":72400}, …]`, `grams` null for a day with no
    /// weigh-in. Same anchor-plus-day-count window as `readDailyHealth`, and
    /// the same rule about where the anchor comes from.
    ///
    /// **Its own function rather than an eleventh column on `readDailyHealth`,
    /// for three reasons that all point the same way.** That call runs on every
    /// foreground to refresh today's snapshot and again over 90 days for the
    /// mood correlations, so a column there would cost a query on every
    /// foreground for a number only one screen reads. Its statistics are the
    /// wrong kind: every metric it collects is cumulative, and `.cumulativeSum`
    /// on body mass would *add up* the day's weigh-ins — step on the scale
    /// twice and you weigh 145kg. And its wire format rounds every value
    /// through `Int()`, which would land 72.4kg as 72.
    ///
    /// **Deliberately no `.separateBySource`, unlike every cumulative read
    /// above.** That option exists there because a phone and a watch counting
    /// one walk get *summed* into double the steps, so the reading has to be
    /// pinned to a single source. An average has no such failure: two apps
    /// reporting the same morning's weight average to that weight, and a scale
    /// and a manual entry that genuinely disagree average to something between
    /// them, which is the honest answer rather than a coin flip on which source
    /// happens to be "best". So the plain `averageQuantity()` is both simpler
    /// and more correct here, and `bestSum`'s reasoning does not transfer.
    ///
    /// **Grams as an integer on the wire, divided back on the JS side.** A
    /// weight is the first fractional number this bridge has had to carry, and
    /// formatting a `Double` into hand-built JSON invites a locale putting a
    /// comma where the parser wants a point. Whole grams are 0.001kg of
    /// precision, which is three digits finer than any bathroom scale reports,
    /// so nothing is lost by staying in the integer format every other reading
    /// already uses.
    AsyncFunction("readWeightSeries") { (anchorISO: String, days: Int, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(),
            days > 0, days <= 400,
            let anchor = Self.parseISO(anchorISO),
            let end = calendar.date(byAdding: .day, value: days, to: anchor),
            let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
        promise.resolve("[]")
        return
      }

      var starts: [Date] = []
      for offset in 0..<days {
        guard let day = calendar.date(byAdding: .day, value: offset, to: anchor) else { break }
        starts.append(day)
      }
      guard starts.count == days else {
        promise.resolve("[]")
        return
      }

      var grams = [Double?](repeating: nil, count: days)
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let query = HKStatisticsCollectionQuery(
          quantityType: type,
          quantitySamplePredicate: HKQuery.predicateForSamples(
            withStart: anchor, end: end, options: .strictStartDate
          ),
          options: [.discreteAverage],
          anchorDate: anchor,
          intervalComponents: DateComponents(day: 1)
        )
        query.initialResultsHandler = { _, collection, _ in
          collection?.enumerateStatistics(from: anchor, to: end) { statistics, _ in
            // Same containment rule as `runDietQuery`: which bucket a result
            // falls in, not which start it equals.
            guard let i = starts.lastIndex(where: { $0 <= statistics.startDate }), i < days else { return }
            guard let quantity = statistics.averageQuantity() else { return }
            grams[i] = quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo)) * 1000
          }
          let entries: [String] = (0..<days).map { i in
            let part = grams[i].map { "\(Int($0.rounded()))" } ?? "null"
            return "{\"start\":\"\(Self.formatISO(starts[i]))\",\"grams\":\(part)}"
          }
          promise.resolve("[" + entries.joined(separator: ",") + "]")
        }
        self.store.execute(query)
        started = true
      }
      if !started { promise.resolve("[]") }
      #else
      promise.resolve("[]")
      #endif
    }
  }

  /// Write an instant the way JavaScript's `Date` will read it back.
  private static func formatISO(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
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
