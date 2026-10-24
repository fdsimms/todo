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
/// (`writeFoodSamples`), a body-mass sample, and a finished strength session
/// (`writeWorkout`) — which have their own type
/// list (`writeTypes`) reviewed on its own terms, a real sample landing in
/// somebody's actual Health record being a bigger deal than a read. See
/// `docs/arch/health-data.md` for why these are the types that earned a
/// write path.
///
/// **The two authorization requests below ask for both halves together, on
/// purpose.** `requestAuthorization` and `requestWriteAuthorization` used to
/// ask for read and write separately, so turning on step-reading never put a
/// water-sharing row in front of somebody who only wanted steps. iOS has
/// since been observed silently revoking an existing write grant the moment
/// read access for the same type is granted later — an undocumented OS bug
/// with no API to prevent or reverse it — so both functions now pass the
/// full `toShare: writeTypes, read: readTypes` regardless of which one was
/// called. That costs the narrower ask; what it buys is that the one
/// sequence that triggers the bug (one half decided, the other decided
/// later) can no longer happen from this app. See `docs/arch/health-data.md`.
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
    // Apple Exercise Time: a cumulative quantity like steps, so it rides the
    // same summed collection query rather than an HKWorkout sample walk. iOS
    // 9.3+, comfortably under this pod's floor.
    if let exercise = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) {
      types.insert(exercise)
    }
    // Time in daylight: minutes an Apple Watch's light sensor judged to be
    // outdoors, a cumulative quantity like exercise time. **iOS 17+, against
    // this pod's 15.1 floor**, so the identifier is only named behind an
    // availability check; an older OS simply never asks for it. Like every
    // addition here, an install that already answered the sheet gets no
    // daylight until somebody taps the access row again.
    if #available(iOS 17.0, *), let daylight = HKQuantityType.quantityType(forIdentifier: .timeInDaylight) {
      types.insert(daylight)
    }
    // Active energy: the calories a body spent *moving*, over and above what it
    // spends existing (that is `basalEnergyBurned`, which this deliberately
    // does not read — a target raised by a resting rate would rise by the same
    // amount every day, which is not a boost, it is a different target). Also
    // a cumulative quantity, so it rides the same summed collection query.
    if let activeEnergy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
      types.insert(activeEnergy)
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
    // Blood pressure: the two halves of a reading, read for the Blood pressure
    // screen (`readBloodPressureSeries`) and written together as one
    // correlation (`writeBloodPressureSample`). Shown, never interpreted.
    // Like every addition here, an install that already answered the sheet
    // gets nothing until somebody taps the access row again.
    if let systolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic) {
      types.insert(systolic)
    }
    if let diastolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) {
      types.insert(diastolic)
    }
    // The Activity rings' own daily record: the three totals *and the goals the
    // person set in Fitness*, which no quantity type carries. Read-only by
    // construction (HealthKit has no way to share one), so it never appears in
    // `writeTypes`. Like every addition here, an install that already answered
    // the sheet gets no rings until somebody taps the access row again.
    types.insert(HKObjectType.activitySummaryType())
    // Workouts other apps recorded (a run, a ride), for the Workouts history's
    // "From Health" rows (`readWorkouts`). Asked for on its own terms rather
    // than inferred from exercise minutes: those are a day's total, and a
    // workout is a thing somebody did with a start and an end. Like every
    // addition here, an install that already answered the sheet gets none
    // until somebody taps the access row again. Non-optional, unlike the
    // quantity types above (`workoutType()`, Apple's doc:
    // https://developer.apple.com/tutorials/data/documentation/healthkit/hkobjecttype/workouttype().json).
    types.insert(HKObjectType.workoutType())
    // Heart rate, for one thing only: the workout page's card, read for a
    // workout the Apple Watch measured (`readWorkoutHeartRate`), shown and
    // never interpreted. Not resting heart rate or HRV, which stay ruled out;
    // `docs/arch/health-data.md`, "Heart rate during a workout", is the review.
    // Like every addition here, an install that already answered the sheet
    // gets no card until somebody taps the access row again.
    // (https://developer.apple.com/tutorials/data/documentation/healthkit/hkquantitytypeidentifier/heartrate.json)
    if let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate) {
      types.insert(heartRate)
    }
    return types
  }

  /// Every type this app will ever ask to *write*. Deliberately
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
    // Blood pressure: the two halves of a reading, read for the Blood pressure
    // screen (`readBloodPressureSeries`) and written together as one
    // correlation (`writeBloodPressureSample`). Shown, never interpreted.
    // Like every addition here, an install that already answered the sheet
    // gets nothing until somebody taps the access row again.
    if let systolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic) {
      types.insert(systolic)
    }
    if let diastolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) {
      types.insert(diastolic)
    }
    // The pulse a blood pressure reading may carry (its two halves are
    // inserted above). Pulse is in the share set but deliberately not in
    // `writeTypes(for: "bloodPressure")`: it is optional, saved after the reading, and reported on its own, so a
    // refusal of it must not make the blood pressure row read as refused.
    if let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate) {
      types.insert(heartRate)
    }
    for entry in Self.nutrientWriteTable {
      if let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) {
        types.insert(type)
      }
    }
    // The drink count a logged meal may carry (`writeFoodSamples`). Like the
    // types added after the first thirteen, an install that already answered
    // the sheet is asked about it when somebody next taps the access row.
    if let alcohol = Self.alcoholType {
      types.insert(alcohol)
    }
    // A finished strength session (`writeWorkout`), its own review in
    // `docs/arch/health-data.md`. `HKWorkoutType` inherits from
    // `HKSampleType`, so it belongs in this set as it stands. Active energy is
    // deliberately *not* added beside it: nothing on the phone measures it
    // for a session, and a share row for a figure the app never writes would
    // be a question asked for nothing. See `writeWorkout`'s energy note.
    types.insert(HKObjectType.workoutType())
    return types
  }

  /// The activity types `readWorkouts` names, each under a stable string the
  /// JS side keys on (`HealthWorkoutActivity` in `src/utils/healthWorkouts.ts`).
  ///
  /// A closed table rather than the enum's raw value, because the raw value is
  /// an integer Apple never promised to anybody and a name is what a screen
  /// needs anyway. Anything not listed reads as `"other"`, which is honest: it
  /// is a workout, of a kind this table doesn't name. Every case here is iOS 14
  /// or older, under the pod's 15.1 floor, so none needs an availability check
  /// (each case's page under
  /// https://developer.apple.com/tutorials/data/documentation/healthkit/hkworkoutactivitytype/
  /// was checked for its introduction). The deprecated `.dance` is left out on
  /// purpose and falls through to `"other"`.
  private static let workoutActivityTable: [(name: String, type: HKWorkoutActivityType)] = [
    ("traditionalStrengthTraining", .traditionalStrengthTraining),
    ("functionalStrengthTraining", .functionalStrengthTraining),
    ("coreTraining", .coreTraining),
    ("highIntensityIntervalTraining", .highIntensityIntervalTraining),
    ("crossTraining", .crossTraining),
    ("mixedCardio", .mixedCardio),
    ("running", .running),
    ("walking", .walking),
    ("hiking", .hiking),
    ("cycling", .cycling),
    ("swimming", .swimming),
    ("rowing", .rowing),
    ("elliptical", .elliptical),
    ("stairClimbing", .stairClimbing),
    ("stairs", .stairs),
    ("stepTraining", .stepTraining),
    ("jumpRope", .jumpRope),
    ("yoga", .yoga),
    ("pilates", .pilates),
    ("barre", .barre),
    ("flexibility", .flexibility),
    ("cooldown", .cooldown),
    ("mindAndBody", .mindAndBody),
    ("taiChi", .taiChi),
    ("cardioDance", .cardioDance),
    ("socialDance", .socialDance),
    ("boxing", .boxing),
    ("kickboxing", .kickboxing),
    ("martialArts", .martialArts),
    ("climbing", .climbing),
    ("tennis", .tennis),
    ("pickleball", .pickleball),
    ("soccer", .soccer),
    ("basketball", .basketball),
    ("golf", .golf),
    ("downhillSkiing", .downhillSkiing),
    ("snowboarding", .snowboarding),
    ("crossCountrySkiing", .crossCountrySkiing),
    ("fitnessGaming", .fitnessGaming),
  ]

  /// The two activity types `writeWorkout` will record. This app logs sets of
  /// weight and reps, so a strength session is the only kind of workout it
  /// can truthfully say happened; a name outside these two is refused rather
  /// than written under some other kind.
  private static let writableWorkoutActivities: Set<String> = [
    "traditionalStrengthTraining",
    "functionalStrengthTraining",
  ]

  private static func workoutActivityName(_ type: HKWorkoutActivityType) -> String {
    return workoutActivityTable.first(where: { $0.type == type })?.name ?? "other"
  }

  /// Every nutrient a logged meal writes, with the identifier and unit each one
  /// is recorded in. The keys are `NutrientKey` from `src/types/index.ts`, so a
  /// figure crosses the bridge under the same name it has on both sides.
  ///
  /// **Thirteen, not the eight `readTypes` collects.** Carbohydrate, total fat
  /// and the three minerals are written but never read: nothing in this app
  /// watches them, no rule fires on them, and no screen shows them from Health.
  /// They are here because the consumer isn't this app — a meal that reaches
  /// the Health app with no carbohydrate line reads as incomplete rather than
  /// as deliberate, and every other app reading this record expects the macros
  /// together. That is a decision made out loud rather than by whatever the
  /// write loop happened to iterate over; see `docs/arch/health-data.md`.
  ///
  /// **Calcium, iron and potassium, and no other micronutrient** — the three
  /// the US mandates on a label and therefore the three the barcode sources
  /// actually carry a figure for. #2430 has the coverage numbers and the note
  /// on `NutrientKey` has the reasoning, vitamin D's absence included.
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
    // Added after the first thirteen, for somebody watching their cholesterol.
    // An install that already allowed nutrition reads `notDetermined` for it
    // until they allow it, the mineral types' arrangement (see
    // `writeAuthorizationStatus`); until then the write skips it.
    ("cholesterolMg", .dietaryCholesterol, HKUnit.gramUnit(with: .milli)),
    ("fiberG", .dietaryFiber, HKUnit.gram()),
    ("sugarG", .dietarySugar, HKUnit.gram()),
    ("sodiumMg", .dietarySodium, HKUnit.gramUnit(with: .milli)),
    ("calciumMg", .dietaryCalcium, HKUnit.gramUnit(with: .milli)),
    ("ironMg", .dietaryIron, HKUnit.gramUnit(with: .milli)),
    ("potassiumMg", .dietaryPotassium, HKUnit.gramUnit(with: .milli)),
    ("caffeineMg", .dietaryCaffeine, HKUnit.gramUnit(with: .milli)),
    ("waterMl", .dietaryWater, HKUnit.literUnit(with: .milli)),
    // The vitamins and minerals, typed from a supplement's panel (never read
    // off a barcode source). Every identifier below was checked against
    // Apple's HKQuantityTypeIdentifier page. Like cholesterol, each is a share
    // type an install that already allowed nutrition has not been asked about,
    // so it reads `notDetermined` until allowed and the write skips it.
    ("vitaminAMcg", .dietaryVitaminA, HKUnit.gramUnit(with: .micro)),
    ("vitaminCMg", .dietaryVitaminC, HKUnit.gramUnit(with: .milli)),
    ("vitaminDMcg", .dietaryVitaminD, HKUnit.gramUnit(with: .micro)),
    ("vitaminEMg", .dietaryVitaminE, HKUnit.gramUnit(with: .milli)),
    ("vitaminKMcg", .dietaryVitaminK, HKUnit.gramUnit(with: .micro)),
    ("thiaminMg", .dietaryThiamin, HKUnit.gramUnit(with: .milli)),
    ("riboflavinMg", .dietaryRiboflavin, HKUnit.gramUnit(with: .milli)),
    ("niacinMg", .dietaryNiacin, HKUnit.gramUnit(with: .milli)),
    ("vitaminB6Mg", .dietaryVitaminB6, HKUnit.gramUnit(with: .milli)),
    ("folateMcg", .dietaryFolate, HKUnit.gramUnit(with: .micro)),
    ("vitaminB12Mcg", .dietaryVitaminB12, HKUnit.gramUnit(with: .micro)),
    ("biotinMcg", .dietaryBiotin, HKUnit.gramUnit(with: .micro)),
    ("pantothenicAcidMg", .dietaryPantothenicAcid, HKUnit.gramUnit(with: .milli)),
    ("magnesiumMg", .dietaryMagnesium, HKUnit.gramUnit(with: .milli)),
    ("zincMg", .dietaryZinc, HKUnit.gramUnit(with: .milli)),
    ("phosphorusMg", .dietaryPhosphorus, HKUnit.gramUnit(with: .milli)),
    ("seleniumMcg", .dietarySelenium, HKUnit.gramUnit(with: .micro)),
    ("copperMg", .dietaryCopper, HKUnit.gramUnit(with: .milli)),
    ("manganeseMg", .dietaryManganese, HKUnit.gramUnit(with: .milli)),
    ("chromiumMcg", .dietaryChromium, HKUnit.gramUnit(with: .micro)),
    ("molybdenumMcg", .dietaryMolybdenum, HKUnit.gramUnit(with: .micro)),
    ("iodineMcg", .dietaryIodine, HKUnit.gramUnit(with: .micro)),
    ("chlorideMg", .dietaryChloride, HKUnit.gramUnit(with: .milli)),
  ]

  /// The type a drink count is saved under, kept out of `nutrientWriteTable`
  /// on purpose. It is not a dietary type and its unit is a count of standard
  /// drinks, where every row of that table is a mass or a volume in the key's
  /// own unit, and a meal is saved as one food correlation of the table's
  /// types. **Whether a food correlation accepts this type has not been
  /// checked** (Apple's pages for the food correlation and for
  /// `numberOfAlcoholicBeverages` do not say, and this could not be run), so it
  /// is saved as a sample of its own beside the meal, where a refusal costs the
  /// drink count and not the meal.
  ///
  /// `numberOfAlcoholicBeverages` is `HKQuantityTypeIdentifier`, iOS 15 and
  /// later, a cumulative count read with `HKUnit.count()`; declaration and
  /// discussion read off
  /// https://developer.apple.com/tutorials/data/documentation/healthkit/hkquantitytypeidentifier/numberofalcoholicbeverages.json
  private static var alcoholType: HKQuantityType? {
    return HKQuantityType.quantityType(forIdentifier: .numberOfAlcoholicBeverages)
  }

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
  /// A list rather than one type, because `"nutrition"` is thirteen of them: a
  /// meal is written as one correlation of thirteen samples, and Health asks
  /// about each share type separately inside that one sheet. What the settings
  /// row does with thirteen answers is `writeAuthorizationStatus`'s problem,
  /// not this one's.
  ///
  /// `[HKObjectType]` rather than `[HKQuantityType]` since `"workout"` joined:
  /// a workout type is not a quantity type, and `authorizationStatus(for:)`,
  /// the only thing the result is handed to, takes any `HKObjectType`.
  private static func writeTypes(for key: String) -> [HKObjectType] {
    switch key {
    case "water":
      return [HKQuantityType.quantityType(forIdentifier: .dietaryWater)].compactMap { $0 }
    case "weight":
      return [HKQuantityType.quantityType(forIdentifier: .bodyMass)].compactMap { $0 }
    case "bloodPressure":
      return [
        HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic),
        HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic),
      ].compactMap { $0 }
    case "nutrition":
      return nutrientWriteTable.compactMap { HKQuantityType.quantityType(forIdentifier: $0.identifier) }
        + [alcoholType].compactMap { $0 }
    case "workout":
      return [HKObjectType.workoutType()]
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
    // A cumulative-sum statistics query on a discrete type raises an
    // NSInvalidArgumentException, so a type that isn't cumulative is skipped
    // (reads as absent) rather than asked. Every identifier passed today is
    // cumulative; this is for the next one added without checking.
    guard let type = HKQuantityType.quantityType(forIdentifier: identifier),
          type.aggregationStyle == .cumulative else {
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

  /// One unbroken stretch of sleep as one source recorded it.
  ///
  /// `minutes` is the time actually asleep inside it, which is less than
  /// `end - start` whenever the stretch holds a short wake: a gap under an
  /// hour is still the same night, but it isn't sleep.
  ///
  /// The stage minutes are what an Apple Watch adds (iOS 16+): `core`, `deep`
  /// and `rem` sum to `minutes` when every sample was staged, and are all zero
  /// for a source that only records "asleep" (an iPhone's sleep schedule).
  /// `awake` is time marked awake *between* two asleep samples of the
  /// episode; awake before falling asleep or after the final wake isn't part
  /// of the night and isn't counted.
  private struct SleepEpisode {
    let source: String
    let start: Date
    let end: Date
    let minutes: Double
    let core: Double
    let deep: Double
    let rem: Double
    let awake: Double
    /// Each staged stretch in order, as raw `HKCategoryValueSleepAnalysis`
    /// values with their start and end. Only the four stages; an unspecified
    /// "asleep" sample counts toward `minutes` but is not drawn.
    let segments: [(value: Int, start: Date, end: Date)]
  }

  /// `HKCategoryValueSleepAnalysis` raw values, for `asleepValues`' reason.
  private static let awakeValue = 2
  private static let coreValue = 3
  private static let deepValue = 4
  private static let remValue = 5

  /// A sleep query's samples grouped into episodes, per source.
  ///
  /// A night is not one sample: a Watch records a fresh `HKCategorySample`
  /// every time the sleep stage changes, often every few minutes, so the
  /// samples are grouped first — a gap longer than an hour between two of them
  /// means the night actually ended (and a nap started later). Per source,
  /// because a phone recording "in bed" and a watch recording stages overlap
  /// for the same night, and merging the two would put people to sleep twice.
  /// Both sleep reads (`readDailyHealth`'s total and `readSleepSeries`' times)
  /// go through this, so the two can't disagree about what a night is.
  private static func sleepEpisodes(_ samples: [HKSample]?) -> [SleepEpisode] {
    let episodeGapSeconds: TimeInterval = 60 * 60
    var bySource: [String: [HKCategorySample]] = [:]
    for sample in (samples as? [HKCategorySample]) ?? [] {
      guard Self.asleepValues.contains(sample.value) || sample.value == Self.awakeValue,
            sample.endDate.timeIntervalSince(sample.startDate) > 0 else { continue }
      let key = sample.sourceRevision.source.bundleIdentifier
      bySource[key, default: []].append(sample)
    }
    var episodes: [SleepEpisode] = []
    for (source, sourceSamples) in bySource {
      var episodeStart: Date?
      var episodeEnd: Date?
      var episodeMinutes: Double = 0
      var core: Double = 0
      var deep: Double = 0
      var rem: Double = 0
      var awake: Double = 0
      var segments: [(value: Int, start: Date, end: Date)] = []
      var pendingSegments: [(value: Int, start: Date, end: Date)] = []
      // Awake time seen since the last asleep sample. It only joins the
      // episode once another asleep sample does, which is what makes it time
      // awake *during* the night rather than before or after it.
      var pendingAwake: Double = 0
      func flush() {
        if let start = episodeStart, let end = episodeEnd, episodeMinutes > 0 {
          episodes.append(SleepEpisode(
            source: source, start: start, end: end, minutes: episodeMinutes,
            core: core, deep: deep, rem: rem, awake: awake, segments: segments
          ))
        }
        episodeStart = nil
        episodeEnd = nil
        episodeMinutes = 0
        core = 0
        deep = 0
        rem = 0
        awake = 0
        pendingAwake = 0
        segments = []
        pendingSegments = []
      }
      for sample in sourceSamples.sorted(by: { $0.startDate < $1.startDate }) {
        let sampleMinutes = sample.endDate.timeIntervalSince(sample.startDate) / 60
        if sample.value == Self.awakeValue {
          // Awake never starts or extends an episode, so the gap rule below
          // still measures from the last time somebody was asleep.
          if episodeStart != nil {
            pendingAwake += sampleMinutes
            pendingSegments.append((sample.value, sample.startDate, sample.endDate))
          }
          continue
        }
        if let prevEnd = episodeEnd,
           sample.startDate.timeIntervalSince(prevEnd) > episodeGapSeconds {
          flush()
        }
        if episodeStart == nil { episodeStart = sample.startDate }
        awake += pendingAwake
        pendingAwake = 0
        segments.append(contentsOf: pendingSegments)
        pendingSegments = []
        if sample.value == Self.coreValue || sample.value == Self.deepValue || sample.value == Self.remValue {
          segments.append((sample.value, sample.startDate, sample.endDate))
        }
        episodeMinutes += sampleMinutes
        if sample.value == Self.coreValue { core += sampleMinutes }
        if sample.value == Self.deepValue { deep += sampleMinutes }
        if sample.value == Self.remValue { rem += sampleMinutes }
        episodeEnd = max(episodeEnd ?? sample.endDate, sample.endDate)
      }
      flush()
    }
    return episodes
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
    ///
    /// **Passes `toShare: writeTypes` too, not `[]`.** This used to ask for
    /// reading alone, on the reasoning that somebody who only wanted to read
    /// steps shouldn't be asked about sharing water in the same breath — see
    /// `docs/arch/health-data.md`'s note on why that stopped being the whole
    /// story. iOS has been observed silently revoking write access to a type
    /// (water, weight, a nutrient) the moment *read* access for that same type
    /// is granted afterward, and there is no supported API to detect that
    /// before it happens or reverse it after. The one thing this app can
    /// actually do about it is make sure that specific sequence — write
    /// decided, read decided later, for the same type — never occurs again:
    /// asking for both together means both are decided in the one user
    /// action, so there is no later solo read grant left to trigger the flip.
    /// `requestWriteAuthorization` below makes the identical change for the
    /// same reason, in the other direction.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve("unavailable")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.requestAuthorization(toShare: self.writeTypes, read: self.readTypes) { success, _ in
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
    /// for the share types named by `kind` ("water" | "weight" | "bloodPressure" | "nutrition" |
    /// "workout").
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
      // `bestSum` makes on the read side. Somebody who allowed twelve nutrients
      // and refused sugar has a row that should send them to the Health app,
      // not one saying "Allowed" over a meal that will land incomplete.
      //
      // This is also what tells an existing install that the mineral types
      // added in #2430 were never asked about: three types it has no answer
      // for drop the row back to `notDetermined`, which is the state the row
      // already renders an ask for. The app never raises the sheet by itself
      // (see `authorizationRequestStatus`), so being visibly un-asked is the
      // only way that re-ask can happen.
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

    /// Ask for write access. Same "unavailable" | "requested" | "failed"
    /// shape as `requestAuthorization`, and the same reason it says no more
    /// than that the sheet was shown — but unlike the read side, a caller that
    /// wants the truth can simply call `writeAuthorizationStatus` right after
    /// this resolves, rather than being stuck with "requested" forever.
    ///
    /// **Passes `read: readTypes` too, not `[]`, for the identical reason
    /// `requestAuthorization` above now passes `toShare: writeTypes`.** This
    /// used to ask only to write, so a task's water-logging row could trigger
    /// it without also raising the unrelated steps/sleep/nutrient read sheet —
    /// but that made *this* call the other half of the same dangerous
    /// sequence: write decided here, read decided later elsewhere, still the
    /// exact trigger for iOS silently revoking the write access just granted.
    /// Folding the read ask in means whichever of the two switches somebody
    /// turns on first, both halves get decided together and there is no later
    /// solo grant left to flip anything.
    AsyncFunction("requestWriteAuthorization") { (promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve("unavailable")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        self.store.requestAuthorization(toShare: self.writeTypes, read: self.readTypes) { success, _ in
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

    /// Writes one blood pressure reading as an `HKCorrelation` of type
    /// `.bloodPressure` holding a systolic and a diastolic sample, which is how
    /// the Health app itself files one. Two loose samples would show up there as
    /// unrelated numbers instead of one reading.
    ///
    /// Whole mmHg in, because a cuff reports whole numbers. The bounds are an
    /// absurdity check for a mistyped digit, not a judgement about anybody, and
    /// a diastolic at or above its systolic is refused, since no reading is
    /// that. Same one-shot shape as `writeBodyMassSample`: no id is kept and no
    /// edit or delete exists here, because Health is the record.
    ///
    /// `pulse` is beats per minute, or 0 for none typed. Resolves a string, not
    /// a Bool: `"saved"`, `"pulseRefused"` (the reading landed and the pulse
    /// did not, which the person must be told rather than left to find out) or
    /// `"failed"` (nothing landed).
    AsyncFunction("writeBloodPressureSample") { (systolic: Int, diastolic: Int, pulse: Int, whenISO: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            systolic >= 40, systolic <= 300, diastolic >= 20, diastolic <= 200,
            diastolic < systolic,
            pulse == 0 || (pulse >= 30 && pulse <= 250),
            let correlationType = HKObjectType.correlationType(forIdentifier: .bloodPressure),
            let systolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic),
            let diastolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) else {
        promise.resolve("failed")
        return
      }
      let when = Self.parseISO(whenISO) ?? Date()
      let unit = HKUnit.millimeterOfMercury()
      let systolicSample = HKQuantitySample(
        type: systolicType, quantity: HKQuantity(unit: unit, doubleValue: Double(systolic)),
        start: when, end: when)
      let diastolicSample = HKQuantitySample(
        type: diastolicType, quantity: HKQuantity(unit: unit, doubleValue: Double(diastolic)),
        start: when, end: when)
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let correlation = HKCorrelation(
          type: correlationType, start: when, end: when,
          objects: [systolicSample, diastolicSample])
        self.store.save(correlation) { success, _ in
          guard success else {
            promise.resolve("failed")
            return
          }
          // `pulse == 0` means none was typed. The pulse is its own sample at
          // the same instant, saved second so that refusing it never costs the
          // reading, and the caller is told which half landed.
          guard pulse > 0, let heartType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            promise.resolve("saved")
            return
          }
          let perMinute = HKUnit.count().unitDivided(by: HKUnit.minute())
          let pulseSample = HKQuantitySample(
            type: heartType, quantity: HKQuantity(unit: perMinute, doubleValue: Double(pulse)),
            start: when, end: when)
          var pulseStarted = false
          TodoHealthExceptionCatcher.runCatchingExceptions {
            self.store.save(pulseSample) { pulseSaved, _ in
              promise.resolve(pulseSaved ? "saved" : "pulseRefused")
            }
            pulseStarted = true
          }
          if !pulseStarted { promise.resolve("pulseRefused") }
        }
        started = true
      }
      if !started { promise.resolve("failed") }
      #else
      promise.resolve("failed")
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

      // Resolved in one pass inside the catcher rather than per nutrient in
      // the loop below, for the reason the type doc gives: `store` is
      // HealthKit, HealthKit raises NSExceptions, and Swift cannot catch one
      // at all — so every call into it goes through here, the same shape
      // `writeAuthorizationStatus` uses for this same query. An exception part
      // way through leaves an empty set, which writes nothing rather than
      // writing something unauthorized.
      var shareable = Set<HKQuantityType>()
      TodoHealthExceptionCatcher.runCatchingExceptions {
        for entry in Self.nutrientWriteTable {
          guard let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) else { continue }
          if self.store.authorizationStatus(for: type) == .sharingAuthorized {
            shareable.insert(type)
          }
        }
      }

      var samples = Set<HKSample>()
      for entry in Self.nutrientWriteTable {
        // `as? Double` alone would drop a whole number, which JSONSerialization
        // hands back as an NSNumber that bridges to Int — and a meal stating
        // "12g protein" is the ordinary case, not an edge one.
        guard let number = parsed[entry.key] as? NSNumber else { continue }
        let value = number.doubleValue
        guard value.isFinite, value >= 0,
              let type = HKQuantityType.quantityType(forIdentifier: entry.identifier) else { continue }
        // A type this app may not share is left out of the correlation rather
        // than put into it, and that is what keeps one refused nutrient from
        // costing the whole meal. The samples go to Health as a single
        // `HKCorrelation`, so if an unauthorized member fails the save, it
        // fails all of it: an install that granted the ten macros before the
        // three minerals of #2430 existed would have stopped recording meals
        // altogether, with nothing on screen to say why.
        //
        // **Which of those two things an unauthorized member actually does is
        // not settled here.** Apple documents `authorizationStatus(for:)` as
        // truthful for share types, which is what this reads, but does not
        // document whether `save` rejects such a correlation outright or drops
        // the member — and it could not be checked from where this was
        // written. The filter is correct either way: under the first it is the
        // difference between a partial meal and no meal, and under the second
        // it changes nothing.
        guard shareable.contains(type) else { continue }
        let quantity = HKQuantity(unit: entry.unit, doubleValue: value)
        samples.insert(HKQuantitySample(type: type, quantity: quantity, start: when, end: when))
      }
      // The drink count, when the meal states one and the person allowed it.
      // Saved as a sample of its own and never put in the correlation (see
      // `alcoholType`), so the meal above is written exactly as it was before
      // this existed and a refusal here costs only the count.
      var alcoholSample: HKQuantitySample?
      if let number = parsed["alcoholDrinks"] as? NSNumber,
         number.doubleValue.isFinite, number.doubleValue > 0,
         let alcoholType = Self.alcoholType {
        var allowed = false
        TodoHealthExceptionCatcher.runCatchingExceptions {
          allowed = self.store.authorizationStatus(for: alcoholType) == .sharingAuthorized
        }
        if allowed {
          let count = HKQuantity(unit: HKUnit.count(), doubleValue: number.doubleValue)
          alcoholSample = HKQuantitySample(type: alcoholType, quantity: count, start: when, end: when)
        }
      }

      guard !samples.isEmpty || alcoholSample != nil else {
        promise.resolve("[]")
        return
      }

      // Resolves the ids of everything that was saved, `"[]"` for nothing.
      let finish: ([String]) -> Void = { ids in
        let encoded = (try? JSONSerialization.data(withJSONObject: ids))
          .flatMap { String(data: $0, encoding: .utf8) }
        promise.resolve(encoded ?? "[]")
      }
      // Saves the drink count after the meal has been answered for, and adds its
      // id to the list so retracting the entry retracts it too.
      let saveAlcohol: ([String]) -> Void = { ids in
        guard let alcohol = alcoholSample else {
          finish(ids)
          return
        }
        var alcoholStarted = false
        TodoHealthExceptionCatcher.runCatchingExceptions {
          self.store.save(alcohol) { success, _ in
            finish(success ? ids + [alcohol.uuid.uuidString] : ids)
          }
          alcoholStarted = true
        }
        if !alcoholStarted { finish(ids) }
      }

      guard !samples.isEmpty else {
        saveAlcohol([])
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
            saveAlcohol([])
            return
          }
          var ids = [meal.uuid.uuidString]
          ids.append(contentsOf: samples.map { $0.uuid.uuidString })
          saveAlcohol(ids)
        }
        started = true
      }
      if !started { saveAlcohol([]) }
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

      var candidates: [HKObjectType] = Self.nutrientWriteTable.compactMap {
        HKQuantityType.quantityType(forIdentifier: $0.identifier)
      }
      // The drink count a meal saved beside it (`writeFoodSamples`), retracted
      // with the rest or it would outlive the entry it came from.
      if let alcohol = Self.alcoholType { candidates.append(alcohol) }
      guard !candidates.isEmpty else {
        promise.resolve(false)
        return
      }
      // A nutrient type this install was never asked to share is one the app
      // never wrote, and deleting from it fails rather than matching nothing:
      // an install that allowed nutrition before a type joined the table (the
      // vitamins, cholesterol) would otherwise report every retraction as a
      // failure. Skipped, as `deleteWorkout` does.
      //
      // The filter runs over the quantity types only. The food correlation is
      // never in `writeTypes` (an app shares a correlation's member types, not
      // the correlation type), so its status is `notDetermined` on every
      // install, or the call raises; filtered with the rest, the meal's
      // correlation object would never be deleted and the Health app would
      // keep an empty meal. It is appended after the filter, unconditionally.
      var types: [HKObjectType] = []
      var checked = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        types = candidates.filter { self.store.authorizationStatus(for: $0) != .notDetermined }
        checked = true
      }
      guard checked else {
        promise.resolve(false)
        return
      }
      if let correlationType = HKObjectType.correlationType(forIdentifier: .food) {
        types.append(correlationType)
      }
      guard !types.isEmpty else {
        promise.resolve(true)
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

    // ─── Workouts ───────────────────────────────────────────────────────────

    /// Writes one finished strength session as an `HKWorkout`, and resolves
    /// what it saved as JSON: `{"workoutId":"…","sampleIds":["…"]}`, or the
    /// string `"null"` when nothing was saved.
    ///
    /// **Built with `HKWorkoutBuilder`, not `HKWorkout(activityType:start:end:)`.**
    /// That initializer is deprecated as of iOS 17 with "Use HKWorkoutBuilder"
    /// as Apple's replacement note
    /// (https://developer.apple.com/tutorials/data/documentation/healthkit/hkworkout/init(activitytype:start:end:).json),
    /// and the builder's completion-handler forms are the shape everything else
    /// in this file already uses. The sequence is Apple's: begin collection at
    /// the start, add what there is, end collection at the end, finish. Every
    /// declaration below was read off its documentation JSON
    /// (`…/healthkit/hkworkoutbuilder/<member>.json`): `init(healthStore:configuration:device:)`,
    /// `beginCollection(withStart:completion:)`, `add(_:completion:)`,
    /// `addMetadata(_:completion:)`, `endCollection(withEnd:completion:)`,
    /// `finishWorkout(completion:)` and `discardWorkout()`.
    ///
    /// **`workoutId` can be null on a write that worked.** `finishWorkout`
    /// hands back a nil workout with no error when it saved one the locked
    /// device can't read back (Apple's own note on that page). The workout is
    /// in Health then and this has no id for it, which is a different answer
    /// from "nothing was written" and is reported as one: the caller must not
    /// retry, or the session lands in Health twice.
    ///
    /// **Energy is attached only when a measured figure is passed, and only
    /// when active-energy sharing is already allowed.** Absent stays absent: a
    /// session with no measured energy writes none, and nothing here estimates
    /// one from sets. Today the second condition is never true, because active
    /// energy is not in `writeTypes` (nothing on the phone measures it for a
    /// session). The branch exists for the watch phase, whose review is where
    /// that share type gets argued for. A zero is treated as no measurement,
    /// the body-mass write's reasoning: no session burns nothing.
    ///
    /// Refuses (`"null"`) without asking anything: an unknown activity, an end
    /// that isn't after the start, a session over a day long or ending in the
    /// future (absurdity checks, like the body-mass ceiling), or workout
    /// sharing not allowed. The last one mirrors `writeFoodSamples`' check of
    /// `authorizationStatus(for:)`, which Apple documents as truthful for
    /// share types.
    ///
    /// `metadataJSON` is a flat object of string or number values saved with
    /// the workout under the app's own keys. A key starting with `HK` is
    /// dropped: those are HealthKit's names, and the ones this sets
    /// (`HKMetadataKeyIndoorWorkout`, and the sync pair below) it sets itself.
    ///
    /// **`syncIdentifier` makes a rewrite replace rather than duplicate.** When
    /// one is passed (the session's id), it is saved as
    /// `HKMetadataKeySyncIdentifier` with an `HKMetadataKeySyncVersion` of the
    /// milliseconds since 1970 at this write. Apple documents the pair on any
    /// `HKObject` saved with them: a save whose identifier matches an existing
    /// object's replaces it when its version is greater
    /// (https://developer.apple.com/tutorials/data/documentation/healthkit/hkmetadatakeysyncidentifier.json,
    /// `let HKMetadataKeySyncIdentifier: String`, a String value, iOS 11.0+;
    /// https://developer.apple.com/tutorials/data/documentation/healthkit/hkmetadatakeysyncversion.json,
    /// `let HKMetadataKeySyncVersion: String`, an NSNumber value, iOS 11.0+;
    /// the identifier's page says adding one requires adding the version).
    /// The version is a clock rather than a fingerprint of the span, because a
    /// workout moved earlier would carry a smaller fingerprint and its rewrite
    /// would lose to the copy it was meant to replace. Whether the builder's
    /// saved workout honours the pair is not stated on the builder's pages;
    /// the identifier's page says any `HKObject`, which a workout is. Set from
    /// its own argument because JS metadata may not name `HK` keys.
    AsyncFunction("writeWorkout") { (startISO: String, endISO: String, activity: String, energyKcal: Double?, metadataJSON: String?, syncIdentifier: String?, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            Self.writableWorkoutActivities.contains(activity),
            let activityType = Self.workoutActivityTable.first(where: { $0.name == activity })?.type,
            let start = Self.parseISO(startISO),
            let end = Self.parseISO(endISO),
            end > start,
            end.timeIntervalSince(start) <= 24 * 60 * 60,
            end <= Date().addingTimeInterval(5 * 60) else {
        promise.resolve("null")
        return
      }

      // Inside the catcher for `writeFoodSamples`' reason: this is HealthKit,
      // and Swift cannot catch the NSException it raises.
      var workoutShareable = false
      var energyShareable = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        workoutShareable = self.store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized
        if let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
          energyShareable = self.store.authorizationStatus(for: energyType) == .sharingAuthorized
        }
      }
      guard workoutShareable else {
        promise.resolve("null")
        return
      }

      let energySample: HKQuantitySample?
      if let kcal = energyKcal, kcal.isFinite, kcal > 0, kcal < 10_000, energyShareable,
         let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
        energySample = HKQuantitySample(
          type: energyType,
          quantity: HKQuantity(unit: HKUnit.kilocalorie(), doubleValue: kcal),
          start: start,
          end: end
        )
      } else {
        energySample = nil
      }

      // `HKMetadataKeyIndoorWorkout` is a Bool in an NSNumber (its page:
      // https://developer.apple.com/tutorials/data/documentation/healthkit/hkmetadatakeyindoorworkout.json).
      // Set explicitly rather than trusting the configuration's `locationType`
      // to produce it, which nothing documents.
      var metadataBuilt: [String: Any] = [HKMetadataKeyIndoorWorkout: NSNumber(value: true)]
      if let json = metadataJSON, let data = json.data(using: .utf8),
         let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        for (key, value) in parsed where !key.isEmpty && !key.hasPrefix("HK") {
          if let text = value as? String {
            metadataBuilt[key] = text
          } else if let number = value as? NSNumber {
            metadataBuilt[key] = number
          }
        }
      }
      if let identifier = syncIdentifier, !identifier.isEmpty {
        metadataBuilt[HKMetadataKeySyncIdentifier] = identifier
        metadataBuilt[HKMetadataKeySyncVersion] = NSNumber(value: Int64((Date().timeIntervalSince1970 * 1000).rounded()))
      }
      let metadata = metadataBuilt

      // `HKWorkoutConfiguration()` is NSObject's init, which is how Apple's
      // own sample code makes one (running-workout-sessions.json).
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = activityType
      configuration.locationType = .indoor

      var builderMade: HKWorkoutBuilder? = nil
      TodoHealthExceptionCatcher.runCatchingExceptions {
        builderMade = HKWorkoutBuilder(healthStore: self.store, configuration: configuration, device: nil)
      }
      guard let builder = builderMade else {
        promise.resolve("null")
        return
      }

      // Each step starts the next from its own completion handler, and each
      // start is inside the catcher with a fallback, so the promise settles
      // exactly once on every path (the module note's `started` rule, applied
      // per step). A step that fails before the finish discards the builder,
      // so a half-built workout is never left behind.
      let abandon: () -> Void = {
        TodoHealthExceptionCatcher.runCatchingExceptions {
          builder.discardWorkout()
        }
        promise.resolve("null")
      }

      let finish: () -> Void = {
        var started = false
        TodoHealthExceptionCatcher.runCatchingExceptions {
          builder.endCollection(withEnd: end) { ended, _ in
            guard ended else {
              abandon()
              return
            }
            var finishing = false
            TodoHealthExceptionCatcher.runCatchingExceptions {
              builder.finishWorkout { workout, error in
                guard error == nil else {
                  promise.resolve("null")
                  return
                }
                // The energy sample's id is carried whether or not the
                // workout's is readable: deleting a workout is not documented
                // to take the samples added to it along, so a retraction
                // names both.
                var result: [String: Any] = [
                  "sampleIds": energySample.map { [$0.uuid.uuidString] } ?? [String](),
                ]
                if let workoutId = workout?.uuid.uuidString {
                  result["workoutId"] = workoutId
                } else {
                  result["workoutId"] = NSNull()
                }
                let encoded = (try? JSONSerialization.data(withJSONObject: result))
                  .flatMap { String(data: $0, encoding: .utf8) }
                promise.resolve(encoded ?? "null")
              }
              finishing = true
            }
            if !finishing { abandon() }
          }
          started = true
        }
        if !started { abandon() }
      }

      // Metadata failing to save costs the indoor flag, the sync pair and the
      // app's own keys, not the session, so the workout is still finished. A
      // workout saved without the sync pair is one a later rewrite sits
      // beside rather than replaces, which the caller's retraction of the old
      // id still covers.
      let saveMetadata: () -> Void = {
        var started = false
        TodoHealthExceptionCatcher.runCatchingExceptions {
          builder.addMetadata(metadata) { _, _ in finish() }
          started = true
        }
        if !started { finish() }
      }

      // Energy failing to attach leaves the workout without energy, which is
      // the absent-stays-absent answer rather than a reason to write nothing.
      let addEnergy: () -> Void = {
        guard let sample = energySample else {
          saveMetadata()
          return
        }
        var started = false
        TodoHealthExceptionCatcher.runCatchingExceptions {
          builder.add([sample]) { _, _ in saveMetadata() }
          started = true
        }
        if !started { saveMetadata() }
      }

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        builder.beginCollection(withStart: start) { began, _ in
          guard began else {
            abandon()
            return
          }
          addEnergy()
        }
        started = true
      }
      if !started { abandon() }
      #else
      promise.resolve("null")
      #endif
    }

    /// Deletes a workout `writeWorkout` saved, and any sample saved with it,
    /// named by `idsJSON` (a JSON array of UUID strings: the workout's id and
    /// the `sampleIds` that came back beside it).
    ///
    /// **Its own function rather than two more types in `deleteHealthSamples`.**
    /// Apple documents `deleteObjects(of:predicate:withCompletion:)` as failing
    /// when the app "has not requested permission to share" the type
    /// (https://developer.apple.com/tutorials/data/documentation/healthkit/hkhealthstore/deleteobjects(of:predicate:withcompletion:).json),
    /// so adding the workout type there would turn every meal's retraction
    /// into a reported failure on an install that never allowed workouts.
    /// For the same reason a type still `notDetermined` is skipped here: this
    /// app can't have saved anything of a type it was never allowed to share.
    /// A type that was allowed and is now refused is still tried, and its
    /// failure is reported, since that is a sample this app wrote and can no
    /// longer take back.
    ///
    /// Same serial-queue tally and the same "no objects matched is not a
    /// failure" rule as `deleteHealthSamples`, for its reasons. Resolves true
    /// when nothing went wrong, a workout the person already deleted in the
    /// Health app included.
    AsyncFunction("deleteWorkout") { (idsJSON: String, promise: Promise) in
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

      var candidates: [HKObjectType] = [HKObjectType.workoutType()]
      if let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
        candidates.append(energyType)
      }
      var types: [HKObjectType] = []
      var checked = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        types = candidates.filter { self.store.authorizationStatus(for: $0) != .notDetermined }
        checked = true
      }
      guard checked else {
        promise.resolve(false)
        return
      }
      guard !types.isEmpty else {
        promise.resolve(true)
        return
      }

      let predicate = HKQuery.predicateForObjects(with: uuids)
      let tally = DispatchQueue(label: "TodoHealthBridge.deleteWorkout")
      var remaining = types.count
      var allSucceeded = true
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        for type in types {
          self.store.deleteObjects(of: type, predicate: predicate) { success, _, error in
            tally.async {
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
    /// All the numbers are nullable per day and null is not zero — a day
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
      var exerciseMinutes = [Double?](repeating: nil, count: days)
      var sodiumMg = [Double?](repeating: nil, count: days)
      var proteinG = [Double?](repeating: nil, count: days)
      var satFatG = [Double?](repeating: nil, count: days)
      var fiberG = [Double?](repeating: nil, count: days)
      var sugarG = [Double?](repeating: nil, count: days)
      var caffeineMg = [Double?](repeating: nil, count: days)
      var waterMl = [Double?](repeating: nil, count: days)
      var calorieKcal = [Double?](repeating: nil, count: days)
      var activeEnergyKcal = [Double?](repeating: nil, count: days)
      var daylightMinutes = [Double?](repeating: nil, count: days)
      // Twelve queries, one promise. `resolve` is called by whichever finishes
      // last, and `pending` is only ever touched on the health store's own
      // serial callback queue, so the count needs no lock.
      // The twelve queries report back on arbitrary background queues, so the
      // countdown runs on a serial queue of its own rather than on whichever
      // thread finished. It does two jobs and both are needed: the decrements
      // cannot interleave (a lost one leaves the promise unresolved for ever,
      // which reads as Health simply never answering, and a doubled one
      // resolves it twice), and every per-day array written before a query's
      // own `finish` is enqueued is therefore visible to the final block that
      // reads all twelve. Each array has exactly one writer, so this is the whole
      // of the sharing.
      let tally = DispatchQueue(label: "TodoHealthBridge.readDailyHealth")
      var pending = 13
      let finish = {
        tally.async {
          pending -= 1
          guard pending == 0 else { return }
          let entries: [String] = (0..<days).map { i in
            let part: (Double?) -> String = { $0.map { "\(Int($0.rounded()))" } ?? "null" }
            return "{\"start\":\"\(Self.formatISO(starts[i]))\",\"steps\":\(part(steps[i])),"
              + "\"sleepMinutes\":\(part(sleepMinutes[i])),"
              + "\"exerciseMinutes\":\(part(exerciseMinutes[i])),"
              + "\"sodiumMg\":\(part(sodiumMg[i])),"
              + "\"proteinG\":\(part(proteinG[i])),\"satFatG\":\(part(satFatG[i])),\"fiberG\":\(part(fiberG[i])),"
              + "\"sugarG\":\(part(sugarG[i])),\"caffeineMg\":\(part(caffeineMg[i])),\"waterMl\":\(part(waterMl[i])),"
              + "\"calorieKcal\":\(part(calorieKcal[i])),"
              + "\"activeEnergyKcal\":\(part(activeEnergyKcal[i])),"
              + "\"daylightMinutes\":\(part(daylightMinutes[i]))}"
          }
          promise.resolve("[" + entries.joined(separator: ",") + "]")
        }
      }

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        // ─── Steps, two things a body did, and eight nutrients: one
        // collection query each, over the whole span ─────────────────────────
        //
        // A collection query rather than one statistics query per day, which
        // is what an anchor-plus-interval window is for: 90 round trips to the
        // health daemon to draw one insight is the version of this that gets
        // noticed. All twelve are cumulative and per-source for the same reason:
        // a phone and a watch both counting steps for one walk, or two
        // food-logging apps both writing the same meal's sodium, would
        // otherwise be double-counted — see `bestSum`. This app never writes
        // any of the nine nutrients itself, so every number here came from
        // whatever food-logging app the person already uses.
        self.runDietQuery(
          identifier: .stepCount, unit: .count(), anchor: anchor, end: end, starts: starts,
          write: { i, value in steps[i] = value }, finish: finish
        )
        // Beside steps rather than among the nutrients: it is the other thing
        // a body did, and it is summed in minutes rather than read off a food
        // label. `HKUnit.minute()` is a non-throwing class func returning Self.
        self.runDietQuery(
          identifier: .appleExerciseTime, unit: .minute(), anchor: anchor, end: end, starts: starts,
          write: { i, value in exerciseMinutes[i] = value }, finish: finish
        )
        // Beside exercise time for the same reason, and `bestSum`'s
        // largest-single-source rule matters more here than for any nutrient:
        // a phone and a watch worn on the same walk each estimate what it cost,
        // and adding the two would raise a calorie target by a walk taken once.
        self.runDietQuery(
          identifier: .activeEnergyBurned, unit: .kilocalorie(), anchor: anchor, end: end, starts: starts,
          write: { i, value in activeEnergyKcal[i] = value }, finish: finish
        )
        // Time in daylight is iOS 17+, so before that it is not asked and its
        // slot in the countdown is spent here instead, which keeps `pending`
        // reaching zero on every OS.
        if #available(iOS 17.0, *) {
          self.runDietQuery(
            identifier: .timeInDaylight, unit: .minute(), anchor: anchor, end: end, starts: starts,
            write: { i, value in daylightMinutes[i] = value }, finish: finish
          )
        } else {
          finish()
        }
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
          // The query has to look further back than `anchor`, or a night gets
          // truncated at whichever hour the window happens to start. A person
          // asleep before `anchor` (nearly everybody, for the 1-day "today"
          // read: `anchor` is midnight-equivalent and most nights are
          // underway well before it) has samples with an `endDate` before
          // `anchor`, and HealthKit's overlap predicate drops any sample
          // whose `endDate` isn't after the query's start — so only the
          // portion of the night after `anchor` came back, read as a night
          // barely a few hours long. The episode grouping below still files
          // the *whole* night under the day its last sample ends in, so
          // fetching further back costs nothing extra: an episode that ends
          // before `anchor` still finds no bucket in `starts` and is dropped
          // exactly as before. A day is the padding — long enough to hold
          // the earliest realistic bedtime for a night ending within the
          // window, and short enough that this stays one cheap query.
          let sleepQueryStart = calendar.date(byAdding: .day, value: -1, to: anchor) ?? anchor
          let query = HKSampleQuery(
            sampleType: type,
            predicate: HKQuery.predicateForSamples(withStart: sleepQueryStart, end: end, options: []),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
          ) { _, samples, _ in
            // Per source, then the largest, for `bestSum`'s reason and a
            // sharper version of it: a phone recording "in bed" and a watch
            // recording stages overlap for the same night, so adding them puts
            // people to sleep twice.
            //
            // Each episode's full duration is filed under the day its *last*
            // sample ends in (`sleepEpisodes` says what an episode is). Every
            // sample of a Watch night crosses whatever instant `dayResetTime`
            // falls on the moment someone is still asleep at that hour, so
            // bucketing samples one by one split a single night's total across
            // the two adjacent days, undercounting both.
            var perDayBySource: [String: [Double]] = [:]
            for episode in Self.sleepEpisodes(samples) {
              guard let i = starts.lastIndex(where: { $0 <= episode.end }), i < days else { continue }
              perDayBySource[episode.source, default: [Double](repeating: 0, count: days)][i] += episode.minutes
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

    /// Every blood pressure reading that started inside the window, newest
    /// last, as JSON: `[{"at":"…","sys":118,"dia":76,"pulse":64}, …]`, where
    /// `pulse` is present only when a heart rate was recorded at exactly the
    /// reading's instant.
    ///
    /// One entry per reading rather than per day, because several a day is the
    /// normal way to take them and averaging a morning against an evening would
    /// hide the thing somebody is measuring. Whole mmHg as integers, like every
    /// other figure on this wire. A correlation missing either half is skipped
    /// rather than half-reported.
    AsyncFunction("readBloodPressureSeries") { (anchorISO: String, days: Int, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(),
            days > 0, days <= 400,
            let anchor = Self.parseISO(anchorISO),
            let end = calendar.date(byAdding: .day, value: days, to: anchor),
            let correlationType = HKObjectType.correlationType(forIdentifier: .bloodPressure),
            let systolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic),
            let diastolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) else {
        promise.resolve("[]")
        return
      }
      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let query = HKSampleQuery(
          sampleType: correlationType,
          predicate: HKQuery.predicateForSamples(withStart: anchor, end: end, options: .strictStartDate),
          limit: HKObjectQueryNoLimit,
          sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, _ in
          let unit = HKUnit.millimeterOfMercury()
          var readings: [(at: Date, sys: Int, dia: Int)] = []
          for case let correlation as HKCorrelation in samples ?? [] {
            guard let sys = (correlation.objects(for: systolicType).first as? HKQuantitySample),
                  let dia = (correlation.objects(for: diastolicType).first as? HKQuantitySample) else { continue }
            readings.append((
              correlation.startDate,
              Int(sys.quantity.doubleValue(for: unit).rounded()),
              Int(dia.quantity.doubleValue(for: unit).rounded())))
          }
          // A pulse belongs to a reading only when it was recorded at the same
          // instant (what this app writes, and what a cuff's app does). Nearby
          // is not the same: a heart rate from the Watch a minute earlier is a
          // different measurement and is never attached.
          let finish: ([Date: Int]) -> Void = { pulses in
            let entries: [String] = readings.map { r in
              let pulse = pulses[r.at].map { ",\"pulse\":\($0)" } ?? ""
              return "{\"at\":\"\(Self.formatISO(r.at))\",\"sys\":\(r.sys),\"dia\":\(r.dia)\(pulse)}"
            }
            promise.resolve("[" + entries.joined(separator: ",") + "]")
          }
          guard !readings.isEmpty, let heartType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            finish([:])
            return
          }
          let pulseQuery = HKSampleQuery(
            sampleType: heartType,
            predicate: HKQuery.predicateForSamples(withStart: anchor, end: end, options: .strictStartDate),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
          ) { _, heartSamples, _ in
            let perMinute = HKUnit.count().unitDivided(by: HKUnit.minute())
            let wanted = Set(readings.map { $0.at })
            var pulses: [Date: Int] = [:]
            for case let sample as HKQuantitySample in heartSamples ?? [] where wanted.contains(sample.startDate) {
              pulses[sample.startDate] = Int(sample.quantity.doubleValue(for: perMinute).rounded())
            }
            finish(pulses)
          }
          self.store.execute(pulseQuery)
        }
        self.store.execute(query)
        started = true
      }
      if !started { promise.resolve("[]") }
      #else
      promise.resolve("[]")
      #endif
    }

    /// Every stretch of sleep that ended inside the window, as JSON:
    /// `[{"start":"…","end":"…","minutes":437,"core":250,"deep":62,"rem":98,
    /// "awake":14,"source":0}, …]`, sorted by
    /// start. `start`/`end` are the first asleep sample's start and the last
    /// one's end, `minutes` the time asleep between them, and `source` an
    /// index standing in for the recording app (stable within one answer and
    /// meaningless across two).
    ///
    /// **Its own function rather than two more columns on `readDailyHealth`**,
    /// for `readWeightSeries`' first reason: that call runs on every foreground
    /// for numbers the Sleep screen alone wants. And it hands back episodes
    /// rather than one fell-asleep/woke-up pair per day, so which episode is a
    /// day's main sleep, which source wins, and which day an episode belongs to
    /// are decided in `src/utils/sleepLog.ts`, where they can be tested — this
    /// side can't be compiled from where the app's logic is written.
    ///
    /// The source is an index rather than the bundle identifier so nothing
    /// typed by another app's developer is spliced into hand-built JSON.
    AsyncFunction("readSleepSeries") { (anchorISO: String, days: Int, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(),
            days > 0, days <= 400,
            let anchor = Self.parseISO(anchorISO),
            let end = calendar.date(byAdding: .day, value: days, to: anchor),
            let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
        promise.resolve("[]")
        return
      }

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        // A day of padding before `anchor` for `readDailyHealth`'s reason: a
        // night ending just after the window opens began before it.
        let queryStart = calendar.date(byAdding: .day, value: -1, to: anchor) ?? anchor
        let query = HKSampleQuery(
          sampleType: type,
          predicate: HKQuery.predicateForSamples(withStart: queryStart, end: end, options: []),
          limit: HKObjectQueryNoLimit,
          sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, _ in
          var sourceIndex: [String: Int] = [:]
          let episodes = Self.sleepEpisodes(samples)
            .filter { $0.end >= anchor }
            .sorted(by: { $0.start < $1.start })
          let entries: [String] = episodes.map { episode in
            let index: Int
            if let known = sourceIndex[episode.source] {
              index = known
            } else {
              index = sourceIndex.count
              sourceIndex[episode.source] = index
            }
            // [stage, seconds from the episode's start, seconds long], kept
            // apart from the line below so the compiler can type-check it.
            let segmentList: [String] = episode.segments.map { seg in
              let offset = Int(seg.start.timeIntervalSince(episode.start).rounded())
              let length = Int(seg.end.timeIntervalSince(seg.start).rounded())
              return "[\(seg.value),\(offset),\(length)]"
            }
            let segmentJSON = segmentList.joined(separator: ",")
            return "{\"start\":\"\(Self.formatISO(episode.start))\","
              + "\"end\":\"\(Self.formatISO(episode.end))\","
              + "\"minutes\":\(Int(episode.minutes.rounded())),"
              + "\"core\":\(Int(episode.core.rounded())),"
              + "\"deep\":\(Int(episode.deep.rounded())),"
              + "\"rem\":\(Int(episode.rem.rounded())),"
              + "\"awake\":\(Int(episode.awake.rounded())),"
              + "\"seg\":[\(segmentJSON)],"
              + "\"source\":\(index)}"
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

    /// The Activity rings for the calendar day `anchorISO` falls on: each ring's
    /// total so far and the goal the person set for it.
    ///
    /// Its own call rather than three more columns on `readDailyHealth`, because
    /// the goals exist only on `HKActivitySummary` and a summary is read with an
    /// `HKActivitySummaryQuery` rather than a statistics collection. It is also
    /// Apple's own account of the rings, so the day's Move/Exercise figures here
    /// are whatever Fitness shows, de-duplicated across devices by Apple, which
    /// is the one thing `bestSum` has to guess at for every other cumulative read.
    ///
    /// Resolves the string `"null"` when there is no summary to report, for every
    /// reason at once (a refused read, a day with no summary, a device with no
    /// rings), which HealthKit does not let this tell apart.
    ///
    /// **Goals of zero or less are sent as null**, since a ring nobody set a goal
    /// for has no target to measure against. **When the Move ring counts Move
    /// Time instead of calories (people under 18 may choose it), the Move figures
    /// are null and `moveMode` says why**: sending that ring's minutes under a
    /// kilocalories name would be a wrong number rather than a missing one.
    ///
    /// The summary is keyed by calendar date, not by this app's logical day, so
    /// with a late `dayResetTime` the rings are the calendar day's. That is how
    /// Fitness itself closes them.
    ///
    /// Everything is whole numbers, for the same hand-built-JSON reason the
    /// other reads give.
    AsyncFunction("readActivitySummary") { (anchorISO: String, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(), let anchor = Self.parseISO(anchorISO) else {
        promise.resolve("null")
        return
      }
      // A summary predicate wants era, year, month and day with the calendar
      // attached; a bare year/month/day matches nothing.
      var components = calendar.dateComponents([.era, .year, .month, .day], from: anchor)
      components.calendar = calendar
      let predicate = HKQuery.predicateForActivitySummary(with: components)

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, _ in
          guard let summary = summaries?.first else {
            promise.resolve("null")
            return
          }
          let whole: (Double?) -> String = { value in
            guard let value = value, value.isFinite, value >= 0 else { return "null" }
            return "\(Int(value.rounded()))"
          }
          let goal: (Double?) -> String = { value in
            guard let value = value, value.isFinite, value > 0 else { return "null" }
            return "\(Int(value.rounded()))"
          }
          // iOS 16 added optional goal properties beside the older non-optional
          // ones (which read 0 when no goal is set). Both land in an
          // `HKQuantity?` so the read below is the same either way.
          let exerciseGoalQuantity: HKQuantity?
          let standGoalQuantity: HKQuantity?
          if #available(iOS 16.0, *) {
            exerciseGoalQuantity = summary.exerciseTimeGoal
            standGoalQuantity = summary.standHoursGoal
          } else {
            exerciseGoalQuantity = summary.appleExerciseTimeGoal
            standGoalQuantity = summary.appleStandHoursGoal
          }
          let movesByTime = summary.activityMoveMode == .appleMoveTime
          let moveKcal = movesByTime ? nil : summary.activeEnergyBurned.doubleValue(for: .kilocalorie())
          let moveGoalKcal = movesByTime ? nil : summary.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie())
          let json = "{\"moveMode\":\"\(movesByTime ? "moveTime" : "activeEnergy")\","
            + "\"moveKcal\":\(whole(moveKcal)),\"moveGoalKcal\":\(goal(moveGoalKcal)),"
            + "\"exerciseMinutes\":\(whole(summary.appleExerciseTime.doubleValue(for: .minute()))),"
            + "\"exerciseGoalMinutes\":\(goal(exerciseGoalQuantity?.doubleValue(for: .minute()))),"
            + "\"standHours\":\(whole(summary.appleStandHours.doubleValue(for: .count()))),"
            + "\"standGoalHours\":\(goal(standGoalQuantity?.doubleValue(for: .count())))}"
          promise.resolve(json)
        }
        self.store.execute(query)
        started = true
      }
      if !started { promise.resolve("null") }
      #else
      promise.resolve("null")
      #endif
    }

    /// Every workout another app recorded that overlaps the `days` days
    /// starting at `anchorISO`, as JSON sorted by start:
    /// `[{"start":"…","end":"…","activity":"running","durationSeconds":1830,
    /// "source":"Strava","energyKcal":312}, …]`.
    ///
    /// **This app's own workouts are left out**, by the bundle identifier of
    /// the app that saved each one (`sourceRevision.source.bundleIdentifier`),
    /// so a session written by `writeWorkout` isn't listed a second time as
    /// "From Health" beside the session it came from. A bundle identifier that
    /// starts with this app's own and a dot is left out too, which is how a
    /// watch app's identifier is formed (`plugins/withWatchApp.js`), so the
    /// watch phase's sessions are covered before they exist.
    ///
    /// **`energyKcal` is omitted when the workout carries none**, never sent as
    /// zero: plenty of workouts are recorded with no energy, and a missing
    /// figure is absent rather than small. It comes from `statistics(for:)`,
    /// iOS 16+, because `totalEnergyBurned` is deprecated as of iOS 18; below
    /// 16 the figure is simply absent. A present zero survives as zero.
    ///
    /// `source` is the recording app's display name, for the "From Health"
    /// attribution. Unlike `readSleepSeries`, which sends an index to keep
    /// another developer's text out of hand-built JSON, this goes through
    /// `JSONSerialization`, which escapes it.
    ///
    /// `[]` for every reason there is nothing to say, a refused read included:
    /// Health serves a refused read as an empty store. Nothing is stored.
    AsyncFunction("readWorkouts") { (anchorISO: String, days: Int, promise: Promise) in
      #if canImport(HealthKit)
      let calendar = Calendar.current
      guard HKHealthStore.isHealthDataAvailable(),
            days > 0, days <= 400,
            let anchor = Self.parseISO(anchorISO),
            let end = calendar.date(byAdding: .day, value: days, to: anchor) else {
        promise.resolve("[]")
        return
      }
      let ownBundle = Bundle.main.bundleIdentifier ?? ""
      let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let query = HKSampleQuery(
          sampleType: HKObjectType.workoutType(),
          predicate: HKQuery.predicateForSamples(withStart: anchor, end: end, options: []),
          limit: HKObjectQueryNoLimit,
          sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, _ in
          // The handler runs after the catcher above has returned, so it gets
          // its own: an exception here would otherwise take the app down.
          var entries: [[String: Any]] = []
          var finished = false
          TodoHealthExceptionCatcher.runCatchingExceptions {
            for sample in samples ?? [] {
              guard let workout = sample as? HKWorkout else { continue }
              let source = workout.sourceRevision.source
              let bundle = source.bundleIdentifier
              if !ownBundle.isEmpty, bundle == ownBundle || bundle.hasPrefix(ownBundle + ".") { continue }
              let duration = workout.duration
              var entry: [String: Any] = [
                "start": Self.formatISO(workout.startDate),
                "end": Self.formatISO(workout.endDate),
                "activity": Self.workoutActivityName(workout.workoutActivityType),
                "source": source.name,
              ]
              if duration.isFinite, duration >= 0 {
                entry["durationSeconds"] = Int(duration.rounded())
              }
              if #available(iOS 16.0, *), let energyType = energyType,
                 let kcal = workout.statistics(for: energyType)?.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie()),
                 kcal.isFinite, kcal >= 0 {
                entry["energyKcal"] = Int(kcal.rounded())
              }
              entries.append(entry)
            }
            finished = true
          }
          guard finished else {
            promise.resolve("[]")
            return
          }
          let encoded = (try? JSONSerialization.data(withJSONObject: entries))
            .flatMap { String(data: $0, encoding: .utf8) }
          promise.resolve(encoded ?? "[]")
        }
        self.store.execute(query)
        started = true
      }
      if !started { promise.resolve("[]") }
      #else
      promise.resolve("[]")
      #endif
    }

    /// Heart rate during one workout, for the workout page's card, as JSON:
    /// `{"start":"…","end":"…","average":128.4,"max":171,
    /// "samples":[[1760464800000,121,1760464800000,1,121],…]}`, or `null`.
    /// Each sample, oldest first, is its start (epoch milliseconds), its
    /// beats per minute, its end, its `count` and its highest reading.
    ///
    /// **A sample can hold a series of readings** (`HKQuantitySample.count`,
    /// iOS 12: "Samples created using an HKQuantitySeriesSampleBuilder may
    /// have a count greater than 1"), and then its `quantity` is their
    /// average ("average for discrete"). The readings inside are not walked
    /// (`HKQuantitySeriesSampleQuery` would, and isn't used until a device has
    /// shown what the watch's session actually stores); the end, the count and
    /// the series' own maximum (`HKDiscreteQuantitySample.maximumQuantity`,
    /// iOS 13) go across instead, and `secondsInZones` spreads the average
    /// over the series' span under the gap rule.
    ///
    /// **The readings are the ones the workout itself carries**
    /// (`HKQuery.predicateForObjects(from:)`: "objects that have been added to
    /// the provided workout"), which is what the Apple Watch's workout session
    /// adds as it measures. Not every reading in the workout's span: a watch
    /// worn all day records heart rate in the background every few minutes,
    /// and dividing those into zones would be a measurement nobody started.
    /// So a workout the phone wrote, with nothing added to it, has none.
    ///
    /// `average` and `max` are the workout's own statistics
    /// (`statistics(for:)`, iOS 16+, what the Fitness app shows), left out
    /// when the workout has none; the JS side works them out from the
    /// readings then (`heartRateSummary`). Never a zero for a missing figure.
    ///
    /// `null` for every reason there is nothing to say (no such workout, no
    /// heart rate, a refused read), which are one answer by Apple's design.
    /// The parse and every rule about the figures are in
    /// `src/utils/heartRateZones.ts`. Nothing is stored.
    AsyncFunction("readWorkoutHeartRate") { (workoutId: String, promise: Promise) in
      #if canImport(HealthKit)
      guard HKHealthStore.isHealthDataAvailable(),
            let uuid = UUID(uuidString: workoutId),
            let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
        promise.resolve("null")
        return
      }
      // Beats per minute: `count()` and `minute()` are class funcs returning
      // Self, `unitDivided(by:)` returns HKUnit
      // (…/healthkit/hkunit/count().json, …/minute().json, …/unitdivided(by:).json).
      let perMinute = HKUnit.count().unitDivided(by: HKUnit.minute())

      var started = false
      TodoHealthExceptionCatcher.runCatchingExceptions {
        let workoutQuery = HKSampleQuery(
          sampleType: HKObjectType.workoutType(),
          predicate: HKQuery.predicateForObject(with: uuid),
          limit: 1,
          sortDescriptors: nil
        ) { _, samples, _ in
          guard let workout = samples?.first as? HKWorkout else {
            promise.resolve("null")
            return
          }
          let startISO = Self.formatISO(workout.startDate)
          let endISO = Self.formatISO(workout.endDate)
          var average: Double? = nil
          var maximum: Double? = nil
          TodoHealthExceptionCatcher.runCatchingExceptions {
            if #available(iOS 16.0, *), let stats = workout.statistics(for: heartRateType) {
              if let value = stats.averageQuantity()?.doubleValue(for: perMinute), value.isFinite, value > 0 {
                average = value
              }
              if let value = stats.maximumQuantity()?.doubleValue(for: perMinute), value.isFinite, value > 0 {
                maximum = value
              }
            }
          }
          let averageFound = average
          let maximumFound = maximum

          var samplesStarted = false
          TodoHealthExceptionCatcher.runCatchingExceptions {
            let sampleQuery = HKSampleQuery(
              sampleType: heartRateType,
              predicate: HKQuery.predicateForObjects(from: workout),
              limit: HKObjectQueryNoLimit,
              sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, readings, _ in
              var points: [[Any]] = []
              TodoHealthExceptionCatcher.runCatchingExceptions {
                for reading in readings ?? [] {
                  guard let sample = reading as? HKQuantitySample else { continue }
                  let value = sample.quantity.doubleValue(for: perMinute)
                  guard value.isFinite, value > 0 else { continue }
                  let ms = (sample.startDate.timeIntervalSince1970 * 1000).rounded()
                  let endMs = (sample.endDate.timeIntervalSince1970 * 1000).rounded()
                  guard ms.isFinite, endMs.isFinite else { continue }
                  // A series' own highest reading; a single reading's is itself.
                  var highest = value
                  if let discrete = sample as? HKDiscreteQuantitySample {
                    let top = discrete.maximumQuantity.doubleValue(for: perMinute)
                    if top.isFinite, top >= value { highest = top }
                  }
                  points.append([Int64(ms), value, Int64(max(endMs, ms)), max(sample.count, 1), highest])
                }
              }
              var body: [String: Any] = ["start": startISO, "end": endISO, "samples": points]
              if let averageFound { body["average"] = averageFound }
              if let maximumFound { body["max"] = maximumFound }
              let encoded = (try? JSONSerialization.data(withJSONObject: body))
                .flatMap { String(data: $0, encoding: .utf8) }
              promise.resolve(encoded ?? "null")
            }
            self.store.execute(sampleQuery)
            samplesStarted = true
          }
          if !samplesStarted { promise.resolve("null") }
        }
        self.store.execute(workoutQuery)
        started = true
      }
      if !started { promise.resolve("null") }
      #else
      promise.resolve("null")
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
