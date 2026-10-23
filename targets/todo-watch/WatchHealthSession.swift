import Foundation
import HealthKit
import WatchKit

// The workout's HealthKit session (phase 9, "Watch W2"; docs/arch/workouts.md,
// "Phase 9, as built", and docs/arch/health-data.md, "Heart rate during a
// workout").
//
// Whenever the watch runs a workout, its own from Start or the phone's live one
// once its screen is opened here, and the phone says workouts go to Apple
// Health (the section's `healthWrite`, the phone's own three switches), it
// measures it with an `HKWorkoutSession` and an `HKLiveWorkoutBuilder`. That
// gives live heart rate (shown as a number with a heart, never judged),
// measured active energy, the app kept in front on the wrist through a rest,
// and the rest's end tapped on the wrist with the wrist down. When the workout
// ends the builder saves an `HKWorkout` with what it measured, and its id and
// times go to the phone, which then writes no copy of its own. With writing
// off, nothing here runs: the workout is phase 8's.
//
// The watch runs one workout session at a time, across every app: starting
// this one ends another app's, and another app starting one ends this
// (`errorAnotherWorkoutSessionStarted`). Hence the screen-opened rule for the
// phone's workout, and no second start for a workout whose session failed.
//
// **Every declaration here was checked against Apple's JSON docs**
// (https://developer.apple.com/tutorials/data/documentation/healthkit/<symbol>.json),
// since nothing compiles Swift where this was written:
// `HKWorkoutSession(healthStore:configuration:) throws` (watchOS 5),
// `associatedWorkoutBuilder() -> HKLiveWorkoutBuilder`, `startActivity(with: Date?)`,
// `stopActivity(with: Date?)`, `end()`, `HKLiveWorkoutDataSource(healthStore:workoutConfiguration:)`,
// `beginCollection(withStart:completion:)`, `endCollection(withEnd:completion:)`,
// `finishWorkout(completion: (HKWorkout?, Error?) -> Void)` (nil workout with
// no error is a save made locked), `discardWorkout()`, `statistics(for:) -> HKStatistics?`,
// `mostRecentQuantity() -> HKQuantity?`, the two required methods of each
// delegate, `recoverActiveWorkoutSession(completion:)`, the deletes
// (`deleteObjects(of:predicate:withCompletion: (Bool, Int, (any Error)?) -> Void)`),
// `HKErrorDomain`, `HKError.Code` (`init?(rawValue: Int)`, `errorNoData`,
// `errorDatabaseInaccessible`, `errorAnotherWorkoutSessionStarted`),
// `HKSample.startDate`/`endDate`, and Foundation's `DateInterval(start:end:)`
// (precondition `end >= start`).
//
// Apple's order for ending (running-workout-sessions.json): `stopActivity`,
// wait for `.stopped`, `endCollection`, `finishWorkout`, then `end()`.

/// What the watch is measuring: the app's session id (the phone's workout, or
/// the watch's own) and when the workout started. Kept in the watch's App
/// Group, so a relaunch after a crash knows what a recovered session was for.
struct WatchMeasurement: Codable, Equatable {
    let sessionId: String
    let startedAt: Date
    /// The phone's workout, whose measuring the phone is told of.
    let phone: Bool
}

enum WatchMeasurementFile {
    static let fileName = "watch_health_session.json"

    private static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> WatchMeasurement? {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WatchMeasurement.self, from: data)
    }

    static func save(_ measurement: WatchMeasurement?) {
        guard let url = fileURL() else { return }
        guard let measurement, let data = try? JSONEncoder().encode(measurement) else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}

/// What came of ending a measurement.
enum WatchHealthOutcome {
    /// Saved, with the workout's id and the times it spans, or both nil when
    /// it saved with the watch locked and has no workout to read them from
    /// (`finishWorkout`'s documented nil). The times go to the phone, which
    /// compares them with the session's own (a retime while it waited).
    case saved(String?, DateInterval?)
    /// Nothing saved: it failed, or there was nothing to save.
    case notSaved
}

/// The one HealthKit workout session the watch runs at a time. Every
/// property is read and written on the main thread; HealthKit's callbacks hop
/// back to it.
final class WatchHealthSession: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let shared = WatchHealthSession()

    /// One store for the app's life, as Apple documents it should be.
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    /// A finish waiting for the session to reach `.stopped`.
    private var finishing: (end: Date, done: (WatchHealthOutcome) -> Void)?

    /// The workout being measured, or nil. Cleared the moment a finish or a
    /// discard begins, so nothing asks twice to end the same one.
    private(set) var measuring: WatchMeasurement?
    /// A session exists (measuring, or still saving one that just ended), or
    /// one is being taken back after a crash, so another can't start yet.
    var busy: Bool { session != nil || measuring != nil || recovering }
    /// The measurement a running session is for: nil while the access sheet
    /// is still up, and once a finish or a discard begins. A running session
    /// is what keeps the app going with the wrist down.
    var running: WatchMeasurement? { session == nil ? nil : measuring }
    /// Asking the system for a session to take back after a crash.
    private var recovering = false

    /// The newest heart rate, in beats per minute, on the main thread.
    var onHeartRate: ((Int) -> Void)?
    /// The session failed after it started, on the main thread: the
    /// measurement is gone and nothing was saved.
    var onFailure: ((WatchMeasurement) -> Void)?
    /// A crashed session was taken back (or there was none), on the main
    /// thread, so the store can match it to what is going on now.
    var onRecovered: (() -> Void)?

    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    // `HKQuantityType(_:)` is non-optional (watchOS 8+, this target is 11).
    private static let heartRateType = HKQuantityType(.heartRate)
    private static let activeEnergyType = HKQuantityType(.activeEnergyBurned)
    /// Beats per minute: `count()` over `minute()`.
    private static let perMinute = HKUnit.count().unitDivided(by: HKUnit.minute())

    // ==== starting ====

    /// Starts measuring `measurement`, asking for Health access first (a
    /// sheet on the wrist the first time, nothing after: the completion runs
    /// at once when every type is already answered). Calls back with whether
    /// it is measuring. Nothing is measured unless workout sharing is
    /// allowed: the workout then runs as it did before this phase.
    func start(_ measurement: WatchMeasurement, completion: @escaping (Bool) -> Void) {
        guard Self.isAvailable, !busy else { completion(false); return }
        measuring = measurement
        // Share the workout and its energy; read the heart rate and energy
        // the session measures (docs/arch/health-data.md, "The new types").
        let share: Set<HKSampleType> = [HKObjectType.workoutType(), Self.activeEnergyType]
        let read: Set<HKObjectType> = [Self.heartRateType, Self.activeEnergyType]
        store.requestAuthorization(toShare: share, read: read) { [weak self] _, _ in
            DispatchQueue.main.async { self?.begin(measurement, completion: completion) }
        }
    }

    private func begin(_ measurement: WatchMeasurement, completion: @escaping (Bool) -> Void) {
        // Still wanted: the workout may have ended while the sheet was up.
        guard measuring == measurement, session == nil else { completion(false); return }
        guard store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized else {
            measuring = nil
            completion(false)
            return
        }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        // It throws for an invalid configuration; `try?` reads either a throw
        // or a nil the same way, as CLAUDE.md asks of a best-effort call.
        guard let made = try? HKWorkoutSession(healthStore: store, configuration: configuration) else {
            measuring = nil
            completion(false)
            return
        }
        let builder = made.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
        made.delegate = self
        builder.delegate = self
        session = made
        self.builder = builder
        WatchMeasurementFile.save(measurement)
        let now = Date()
        made.startActivity(with: now)
        // The workout starts when it did, not when the watch joined: Apple's
        // guidance for a workout begun on the iPhone and opened on the watch is
        // to give the watch's workout the iPhone workout's start. Readings are
        // only collected from now.
        builder.beginCollection(withStart: min(measurement.startedAt, now)) { [weak self] ok, _ in
            DispatchQueue.main.async {
                guard let self, self.builder === builder else { return }
                if ok {
                    completion(true)
                } else {
                    self.tearDown(discarding: true)
                    completion(false)
                }
            }
        }
    }

    // ==== ending ====

    /// Ends the measurement and saves the workout, ending at `end` (never
    /// before it started, never in the future).
    func finish(at end: Date, completion: @escaping (WatchHealthOutcome) -> Void) {
        guard let session, builder != nil, finishing == nil, let measurement = measuring else {
            // Still asking for access, so nothing started: let the ask's
            // answer find the measurement gone, rather than start one for a
            // workout that has already ended.
            if session == nil { measuring = nil }
            completion(.notSaved)
            return
        }
        measuring = nil
        let clamped = max(min(end, Date()), measurement.startedAt)
        finishing = (clamped, completion)
        switch session.state {
        case .running, .paused:
            session.stopActivity(with: clamped)
            // Saved on `.stopped` (the delegate below); and anyway after a few
            // seconds, so a session that never says so can't strand the save.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.save(session) }
        default:
            save(session)
        }
    }

    /// Ends the measurement and saves nothing: a workout of the watch's own
    /// with nothing done, writing turned off on the phone, or a workout the
    /// phone threw away.
    func discard() {
        guard session != nil || measuring != nil else { return }
        if let pending = finishing {
            finishing = nil
            pending.done(.notSaved)
        }
        tearDown(discarding: true)
    }

    private func save(_ which: HKWorkoutSession) {
        guard which === session, let pending = finishing, let builder else { return }
        finishing = nil
        // Each callback tears down only the session it was saving: a discard
        // meanwhile already let this one go, and the next one may be running
        // by the time the save answers.
        builder.endCollection(withEnd: pending.end) { [weak self] ok, _ in
            guard ok else {
                DispatchQueue.main.async {
                    if let self, self.session === which { self.tearDown(discarding: true) }
                    pending.done(.notSaved)
                }
                return
            }
            builder.finishWorkout { workout, error in
                DispatchQueue.main.async {
                    if let self, self.session === which { self.tearDown(discarding: false) }
                    guard error == nil else { pending.done(.notSaved); return }
                    let span = workout.map { DateInterval(start: $0.startDate, end: max($0.endDate, $0.startDate)) }
                    pending.done(.saved(workout?.uuid.uuidString, span))
                }
            }
        }
    }

    /// Lets the session go. A builder not finished is discarded first, so a
    /// half-built workout is never left behind.
    private func tearDown(discarding: Bool) {
        if discarding { builder?.discardWorkout() }
        session?.end()
        session = nil
        builder = nil
        measuring = nil
        finishing = nil
        WatchMeasurementFile.save(nil)
    }

    // ==== a crash mid-workout ====

    /// The system relaunched the app after it crashed mid-workout
    /// (`handleActiveWorkoutRecovery`, WatchAppDelegate): take the session
    /// back and set its data source and delegates up again, as Apple
    /// documents. One whose workout this app no longer knows is ended unsaved.
    func recover() {
        guard !recovering else { return }
        // Busy until the system answers, so nothing starts a second session
        // over the one being taken back.
        recovering = true
        store.recoverActiveWorkoutSession { [weak self] recovered, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.recovering = false
                defer { self.onRecovered?() }
                guard let recovered, recovered !== self.session else { return }
                // A session of this app's is already running (it can't be,
                // with `busy` held, but if it is it stays), or the file names
                // no workout: the recovered one is ended unsaved.
                guard self.session == nil, self.measuring == nil, let measurement = WatchMeasurementFile.load() else {
                    recovered.associatedWorkoutBuilder().discardWorkout()
                    recovered.end()
                    return
                }
                let builder = recovered.associatedWorkoutBuilder()
                builder.dataSource = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: recovered.workoutConfiguration)
                recovered.delegate = self
                builder.delegate = self
                self.session = recovered
                self.builder = builder
                self.measuring = measurement
            }
        }
    }

    // ==== retracting for the phone ====

    /// Deletes workouts this app saved, by id, each with the active energy
    /// saved with it, and calls back with the ids it dealt with: deleted, or
    /// already gone (nothing matched, or `errorNoData`). Any other error
    /// leaves the id out, so the phone's list keeps it and the next try
    /// (the next snapshot, the app coming to the front) has another go: the
    /// usual one is `errorDatabaseInaccessible`, the watch locked. Heart rate
    /// taken during one stays in Health as readings: this app never shares
    /// heart rate, so it may not delete it (`delete(_:withCompletion:)`:
    /// "Your app can delete only those objects that it has previously saved").
    func retract(_ ids: [String], completion: @escaping ([String]) -> Void) {
        guard Self.isAvailable, !ids.isEmpty else { completion([]); return }
        let tally = DispatchQueue(label: "WatchHealthSession.retract")
        let group = DispatchGroup()
        var dealt: [String] = []
        for id in ids {
            guard let uuid = UUID(uuidString: id) else {
                // Not an id HealthKit ever gave out: nothing will ever match it.
                tally.sync { dealt.append(id) }
                continue
            }
            group.enter()
            let answered = { (gone: Bool) in tally.async { if gone { dealt.append(id) }; group.leave() } }
            let byId = HKQuery.predicateForObject(with: uuid)
            // The energy goes first, while the workout it hangs off is still
            // there to be found; then the workout itself, which needs no read.
            // A step that fails stops there, so energy is never left behind
            // with no workout to find it by.
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: byId, limit: 1, sortDescriptors: nil) { [weak self] _, samples, error in
                guard let self else { answered(false); return }
                if let error { answered(Self.isNoData(error)); return }
                guard let workout = samples?.first as? HKWorkout else { answered(true); return }
                self.store.deleteObjects(of: Self.activeEnergyType, predicate: HKQuery.predicateForObjects(from: workout)) { ok, _, error in
                    guard ok || error.map(Self.isNoData) == true else { answered(false); return }
                    self.store.deleteObjects(of: HKObjectType.workoutType(), predicate: byId) { ok, _, error in
                        answered(ok || error.map(Self.isNoData) == true)
                    }
                }
            }
            store.execute(query)
        }
        group.notify(queue: tally) {
            let done = dealt
            DispatchQueue.main.async { completion(done) }
        }
    }

    /// HealthKit's "there is no data", which for a delete means already gone.
    /// Read as an NSError (`HKErrorDomain`, `HKError.Code.errorNoData`), the
    /// form every HealthKit callback's `Error` bridges from.
    private static func isNoData(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == HKErrorDomain && ns.code == HKError.Code.errorNoData.rawValue
    }

    // ==== HKWorkoutSessionDelegate ====

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        guard toState == .stopped else { return }
        DispatchQueue.main.async { [weak self] in self?.save(workoutSession) }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, workoutSession === self.session else { return }
            let lost = self.measuring
            if let pending = self.finishing {
                self.finishing = nil
                pending.done(.notSaved)
            }
            self.tearDown(discarding: true)
            if let lost { self.onFailure?(lost) }
        }
    }

    // ==== HKLiveWorkoutBuilderDelegate ====

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(Self.heartRateType),
              let bpm = workoutBuilder.statistics(for: Self.heartRateType)?.mostRecentQuantity()?.doubleValue(for: Self.perMinute),
              bpm.isFinite, bpm > 0 else { return }
        let rounded = Int(bpm.rounded())
        DispatchQueue.main.async { [weak self] in
            guard let self, workoutBuilder === self.builder, self.measuring != nil else { return }
            self.onHeartRate?(rounded)
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

/// The app delegate, for the one thing the SwiftUI app can't do alone: take a
/// workout session back after a crash.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func handleActiveWorkoutRecovery() {
        WatchHealthSession.shared.recover()
    }
}

// ==== The store's side ====

extension WatchStore {
    /// Hooks the session's two callbacks to the store, once, at launch.
    func connectHealthSession() {
        let health = WatchHealthSession.shared
        health.onHeartRate = { [weak self] bpm in self?.heartRate = bpm }
        health.onFailure = { [weak self] lost in
            guard let self else { return }
            self.heartRate = nil
            // Never started again for this workout. The usual failure is
            // `errorAnotherWorkoutSessionStarted`: the person started another
            // workout app, and the watch runs one session at a time
            // ("the original session receives this error message and then
            // ends"). Starting again would end theirs in turn.
            self.refusedMeasurements.insert(lost.sessionId)
            // The phone held its own write back for the watch's: it writes
            // as Save would, since none is coming.
            if lost.phone {
                self.recordWorkoutTap(kind: "measuring", itemId: lost.sessionId, sessionId: lost.sessionId, on: false)
            }
            self.restoreRestNotification()
        }
        health.onRecovered = { [weak self] in self?.syncHealthSession() }
    }

    /// The workout screen was opened on the phone's workout: from now on the
    /// watch measures it (`wantedMeasurement`). Called by the screen itself.
    func openedWorkoutScreen(_ screen: WatchWorkoutScreen) {
        guard screen.source == .phone, openedPhoneWorkout != screen.sessionId else { return }
        openedPhoneWorkout = screen.sessionId
        syncHealthSession()
    }

    /// The workout the watch should be measuring now, if any, while the
    /// phone says workouts go to Health: its own, from Start; or the phone's
    /// live one, once its workout screen has been opened here.
    ///
    /// **Not before that screen opens**, because the watch runs one workout
    /// session at a time and starting this app's ends any other app's (Apple's
    /// Workout app's included). A phone workout merely showing on Today, with
    /// the person running something else on the wrist, must not take over;
    /// opening its screen is the person choosing this one. Once measuring,
    /// it carries on wherever the screens go, and a relaunch that took the
    /// session back counts as opened. A workout whose session failed here is
    /// not started again (`refusedMeasurements`).
    var wantedMeasurement: WatchMeasurement? {
        guard WatchHealthSession.isAvailable, workoutSection?.healthWrite == true else { return nil }
        if let own = ownWorkout {
            guard !refusedMeasurements.contains(own.id) else { return nil }
            return WatchMeasurement(sessionId: own.id, startedAt: own.startedAt, phone: false)
        }
        guard let screen = workoutScreen, screen.source == .phone, let start = screen.startedAt,
              !refusedMeasurements.contains(screen.sessionId) else { return nil }
        let opened = openedPhoneWorkout == screen.sessionId
            || WatchHealthSession.shared.measuring?.sessionId == screen.sessionId
        guard opened else { return nil }
        return WatchMeasurement(sessionId: screen.sessionId, startedAt: start, phone: true)
    }

    /// Starts, saves or throws away the measurement to match what is going
    /// on. Run when a snapshot arrives, when the app comes to the front and
    /// when a workout starts or ends here. A new one starts only with the app
    /// in front (opening the phone's workout here is what starts measuring
    /// it, as Apple's guidance has it); ending needs nothing.
    func syncHealthSession() {
        endIdleOwnWorkout()
        let health = WatchHealthSession.shared
        let want = wantedMeasurement
        if let current = health.measuring, current.sessionId != want?.sessionId {
            endMeasurement(current)
        }
        // `isActive` follows the scene; the application's own state is also
        // read, since a launch in the background to take a snapshot starts
        // with `isActive` still at its default.
        guard let want, isActive, WKApplication.shared().applicationState == .active, !health.busy else { return }
        health.start(want) { [weak self] started in
            guard let self, started, want.phone else { return }
            // So the phone holds its own Health write back for this one.
            self.recordWorkoutTap(kind: "measuring", itemId: want.sessionId, sessionId: want.sessionId, on: true)
        }
    }

    /// A measurement no longer wanted. Thrown away when writing went off on
    /// the phone, when the phone deleted the workout (`dropSessions`), or for
    /// a workout of the watch's own (whose Finish saves it explicitly).
    /// Otherwise it is the phone's workout leaving the snapshot because it
    /// finished there: saved, ending when the phone's did.
    private func endMeasurement(_ measurement: WatchMeasurement) {
        let section = workoutSection
        let dropped = section?.dropSessions.contains(measurement.sessionId) == true
        if !measurement.phone || section?.healthWrite != true || dropped {
            WatchHealthSession.shared.discard()
            heartRate = nil
            // The phone held its own write back for this one. Writing went
            // off there, so it writes nothing now, but the row comes off
            // waiting for the watch, and a session deleted there needs nothing.
            if measurement.phone && !dropped {
                recordWorkoutTap(kind: "measuring", itemId: measurement.sessionId, sessionId: measurement.sessionId, on: false)
            }
            restoreRestNotification()
            return
        }
        let end = section?.finished.first(where: { $0.sessionId == measurement.sessionId }).flatMap { isoDate($0.endedAt) } ?? Date()
        saveMeasurement(measurement, at: end)
    }

    /// Saves the measurement of the phone's workout, and tells the phone what
    /// was saved, or that nothing was, so it writes its own.
    func saveMeasurement(_ measurement: WatchMeasurement, at end: Date) {
        WatchHealthSession.shared.finish(at: end) { [weak self] outcome in
            guard let self else { return }
            self.heartRate = nil
            switch outcome {
            case .saved(let workoutId, let span):
                self.recordWorkoutTap(
                    kind: "healthWorkout", itemId: measurement.sessionId, sessionId: measurement.sessionId,
                    healthWorkoutId: workoutId, workoutSpan: span
                )
            case .notSaved:
                self.recordWorkoutTap(kind: "measuring", itemId: measurement.sessionId, sessionId: measurement.sessionId, on: false)
            }
            self.syncHealthSession()
        }
    }

    /// Retracts what the phone asks (`retractWorkouts`) and says so with a tap
    /// per workout dealt with, which takes it off the phone's list. One the
    /// delete couldn't reach (the watch locked) stays on it and is tried
    /// again with the next snapshot or when the app comes to the front.
    func processRetractions() {
        guard let ids = workoutSection?.retractWorkouts, !ids.isEmpty else { return }
        let local = self.local
        let todo = ids.filter { !local.retractedWorkouts.contains($0) && !retractionsInFlight.contains($0) }
        guard !todo.isEmpty else { return }
        retractionsInFlight.formUnion(todo)
        WatchHealthSession.shared.retract(todo) { [weak self] done in
            guard let self else { return }
            self.retractionsInFlight.subtract(todo)
            for id in done { self.recordWorkoutTap(kind: "healthRetracted", itemId: id) }
        }
    }

    /// The heart rate to show on `screen`: the session's, while it measures
    /// that workout. The number only.
    func shownHeartRate(on screen: WatchWorkoutScreen) -> Int? {
        guard let bpm = heartRate, WatchHealthSession.shared.measuring?.sessionId == screen.sessionId else { return nil }
        return bpm
    }
}
