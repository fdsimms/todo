import Foundation
import HealthKit
import WatchKit

// The workout's HealthKit session (phase 9, "Watch W2"; docs/arch/workouts.md,
// "Phase 9, as built", and docs/arch/health-data.md, "Heart rate during a
// workout").
//
// Whenever the watch runs a workout, its own or the phone's live one, and the
// phone says workouts go to Apple Health (the section's `healthWrite`, the
// phone's own three switches), it measures it with an `HKWorkoutSession` and an
// `HKLiveWorkoutBuilder`. That gives live heart rate (shown as a number with a
// heart, never judged), measured active energy, and the app kept in front on
// the wrist through a rest. When the workout ends the builder saves an
// `HKWorkout` with what it measured, and its id goes to the phone, which then
// writes no copy of its own. With writing off, nothing here runs: the workout
// is phase 8's.
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
// delegate, `recoverActiveWorkoutSession(completion:)`, and the deletes.
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
    /// Saved, with the workout's id, or nil when it saved with the watch
    /// locked and has no id to give (`finishWorkout`'s documented nil).
    case saved(String?)
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
    /// A session exists (measuring, or still saving one that just ended),
    /// so another can't start yet.
    var busy: Bool { session != nil || measuring != nil }

    /// The newest heart rate, in beats per minute, on the main thread.
    var onHeartRate: ((Int) -> Void)?
    /// The session failed after it started, on the main thread: the
    /// measurement is gone and nothing was saved.
    var onFailure: ((WatchMeasurement) -> Void)?

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
        builder.endCollection(withEnd: pending.end) { [weak self] ok, _ in
            guard ok else {
                DispatchQueue.main.async {
                    self?.tearDown(discarding: true)
                    pending.done(.notSaved)
                }
                return
            }
            builder.finishWorkout { workout, error in
                DispatchQueue.main.async {
                    self?.tearDown(discarding: false)
                    pending.done(error == nil ? .saved(workout?.uuid.uuidString) : .notSaved)
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
        store.recoverActiveWorkoutSession { [weak self] recovered, _ in
            DispatchQueue.main.async {
                guard let self, let recovered, self.session == nil else { return }
                guard let measurement = WatchMeasurementFile.load() else {
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
    /// saved with it, and calls back with the ids it dealt with. Each is tried
    /// once: deleted, already gone, or refused, after which a workout still
    /// there is the person's to delete in Health. Heart rate taken during one
    /// stays in Health as readings: this app never shares heart rate, so it
    /// may not delete it (`delete(_:withCompletion:)`: "Your app can delete
    /// only those objects that it has previously saved").
    func retract(_ ids: [String], completion: @escaping ([String]) -> Void) {
        guard Self.isAvailable, !ids.isEmpty else { completion(ids); return }
        let tally = DispatchQueue(label: "WatchHealthSession.retract")
        let group = DispatchGroup()
        var dealt: [String] = []
        for id in ids {
            guard let uuid = UUID(uuidString: id) else {
                tally.sync { dealt.append(id) }
                continue
            }
            group.enter()
            let finished = { tally.async { dealt.append(id); group.leave() } }
            let byId = HKQuery.predicateForObject(with: uuid)
            // The energy goes first, while the workout it hangs off is still
            // there to be found; then the workout itself, which needs no read.
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: byId, limit: 1, sortDescriptors: nil) { [weak self] _, samples, _ in
                guard let self else { finished(); return }
                let deleteWorkout = {
                    self.store.deleteObjects(of: HKObjectType.workoutType(), predicate: byId) { _, _, _ in finished() }
                }
                guard let workout = samples?.first as? HKWorkout else { deleteWorkout(); return }
                self.store.deleteObjects(of: Self.activeEnergyType, predicate: HKQuery.predicateForObjects(from: workout)) { _, _, _ in
                    deleteWorkout()
                }
            }
            store.execute(query)
        }
        group.notify(queue: tally) {
            let done = dealt
            DispatchQueue.main.async { completion(done) }
        }
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
            // The phone held its own write back for the watch's: it writes
            // as Save would, since none is coming.
            if lost.phone {
                self.recordWorkoutTap(kind: "measuring", itemId: lost.sessionId, sessionId: lost.sessionId, on: false)
            }
        }
    }

    /// The workout the watch should be measuring now, if any: its own, or
    /// the phone's live one it is showing, while the phone says workouts go
    /// to Health.
    var wantedMeasurement: WatchMeasurement? {
        guard WatchHealthSession.isAvailable, workoutSection?.healthWrite == true else { return nil }
        if let own = ownWorkout {
            return WatchMeasurement(sessionId: own.id, startedAt: own.startedAt, phone: false)
        }
        guard let screen = workoutScreen, screen.source == .phone, let start = screen.startedAt else { return nil }
        return WatchMeasurement(sessionId: screen.sessionId, startedAt: start, phone: true)
    }

    /// Starts, saves or throws away the measurement to match what is going
    /// on. Run when a snapshot arrives, when the app comes to the front and
    /// when a workout starts or ends here. A new one starts only with the app
    /// in front (opening the watch app while the phone's workout runs is what
    /// starts measuring it, as Apple's guidance has it); ending needs nothing.
    func syncHealthSession() {
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
        if !measurement.phone || section?.healthWrite != true || section?.dropSessions.contains(measurement.sessionId) == true {
            WatchHealthSession.shared.discard()
            heartRate = nil
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
            case .saved(let workoutId):
                self.recordWorkoutTap(
                    kind: "healthWorkout", itemId: measurement.sessionId, sessionId: measurement.sessionId,
                    healthWorkoutId: workoutId
                )
            case .notSaved:
                self.recordWorkoutTap(kind: "measuring", itemId: measurement.sessionId, sessionId: measurement.sessionId, on: false)
            }
            self.syncHealthSession()
        }
    }

    /// Retracts what the phone asks (`retractWorkouts`), once each, and says
    /// so with a tap per workout, which takes it off the phone's list.
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
