import Foundation
import SwiftUI
import UserNotifications
import WatchConnectivity
import WatchKit

// The workout on the watch (phase 8, "Watch W1"; docs/arch/workouts.md).
//
// Two ways a workout runs here, and the screens draw both the same way:
//
// - **The phone's.** A workout going on the iPhone arrives in the snapshot's
//   workout section (`WatchLiveWorkout`). A set done here goes back as a tap
//   ("set", with its numbers), as do the rest's +30 s and Skip and Finish
//   workout, and the watch draws them over the snapshot until the phone has
//   applied them, the way it draws a ticked task (LocalTapState).
// - **Its own.** With no workout going on the phone, Start lays a routine out
//   from the plan the snapshot carries (what the phone would lay out right
//   now), and the watch runs it with no phone at all: the sets, their numbers
//   and the rest are kept in this file's `WatchOwnWorkout`, in the watch's App
//   Group so it outlives the app being closed. Finish sends the whole workout
//   once ("watchSession"), queued until the phone is in reach.
//
// **The rules are the phone's.** Each set arrives in the order it is done
// (supersets alternated), worded, with the rest ticking it starts already
// worked out (`WatchWorkoutSet.rest`): this file walks the list in order and
// reads those answers, and has no superset or rest rule of its own.
//
// **A rest never moves anything on.** When it runs out the screen turns to
// "Rest is over", counts up, and waits for "Go to the set".

// ==== From the phone ====

/// The boxes a set shows, in the order a row shows them (`setFieldsFor` in the app).
enum WatchSetField: Hashable {
    case weight, reps, duration, distance
}

struct WatchWorkoutExercise: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    /// The app's `ExerciseKind`.
    let kind: String

    enum CodingKeys: String, CodingKey { case id, name, kind }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "weight_reps"
    }

    var fields: [WatchSetField] {
        switch kind {
        case "bodyweight_reps": return [.reps]
        case "duration": return [.duration]
        case "distance": return [.distance]
        case "weight_distance": return [.weight, .distance]
        default: return [.weight, .reps]
        }
    }

    /// An assisted exercise's weight is the help, which the phone's column calls "−kg".
    var weightIsAssistance: Bool { kind == "assisted_reps" }
}

/// One set, as the phone words it (`WatchWorkoutSet` in watchWorkout.ts), and
/// as the watch's own workout keeps it.
struct WatchWorkoutSet: Codable, Identifiable, Equatable {
    /// The phone's set id on a live workout's set, the watch's own on its own
    /// workout's. Empty on a routine's plan until Start gives it one.
    var id: String
    let exerciseId: String
    let position: Int
    let setIndex: Int
    /// "warmup", "working", "drop" or "amrap".
    let kind: String
    /// "Set 3 of 4", "Warm-up", "Drop set".
    let label: String
    /// "W" or "D", drawn in orange in front of the label.
    let badge: String?
    /// "Next: Bench press, set 4".
    let next: String
    /// The rest this set starts when it is done: more than 0 starts one, 0
    /// drops the one going, -1 leaves it as it is (mid superset round).
    let rest: Int
    var weight: Double?
    var reps: Int?
    var durationSeconds: Int?
    var distanceM: Double?
    /// When it was done, as ISO text, or nil while it is still to do.
    var doneAt: String?

    enum CodingKeys: String, CodingKey {
        case id, exerciseId, position, setIndex, kind, label, badge, next, rest
        case weight, reps, durationSeconds, distanceM, doneAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        position = try c.decodeIfPresent(Int.self, forKey: .position) ?? 0
        setIndex = try c.decodeIfPresent(Int.self, forKey: .setIndex) ?? 0
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "working"
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        badge = try c.decodeIfPresent(String.self, forKey: .badge)
        next = try c.decodeIfPresent(String.self, forKey: .next) ?? ""
        rest = try c.decodeIfPresent(Int.self, forKey: .rest) ?? 0
        weight = try c.decodeIfPresent(Double.self, forKey: .weight)
        reps = try c.decodeIfPresent(Int.self, forKey: .reps)
        durationSeconds = try c.decodeIfPresent(Int.self, forKey: .durationSeconds)
        distanceM = try c.decodeIfPresent(Double.self, forKey: .distanceM)
        doneAt = try c.decodeIfPresent(String.self, forKey: .doneAt)
    }

    var isDone: Bool { doneAt != nil }
    var doneDate: Date? { doneAt.flatMap(isoDate) }

    var values: WatchSetValues {
        WatchSetValues(weight: weight, reps: reps, durationSeconds: durationSeconds, distanceM: distanceM)
    }

    /// Done now, with these numbers.
    func done(_ values: WatchSetValues, at date: Date) -> WatchWorkoutSet {
        var copy = self
        if let weight = values.weight { copy.weight = weight }
        if let reps = values.reps { copy.reps = reps }
        if let durationSeconds = values.durationSeconds { copy.durationSeconds = durationSeconds }
        if let distanceM = values.distanceM { copy.distanceM = distanceM }
        copy.doneAt = watchISO(date)
        return copy
    }
}

/// The phone's rest, as two fixed instants.
struct WatchPhoneRest: Codable, Equatable {
    let id: String
    let startedAt: String
    let endsAt: String
}

struct WatchLiveWorkout: Decodable {
    let sessionId: String
    let title: String
    let startedAt: String
    let exercises: [WatchWorkoutExercise]
    let sets: [WatchWorkoutSet]
    /// Sets past what the phone sent, which only the phone shows.
    let moreSets: Int
    let rest: WatchPhoneRest?

    enum CodingKeys: String, CodingKey { case sessionId, title, startedAt, exercises, sets, moreSets, rest }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt) ?? ""
        exercises = try c.decodeIfPresent([WatchWorkoutExercise].self, forKey: .exercises) ?? []
        sets = try c.decodeIfPresent([WatchWorkoutSet].self, forKey: .sets) ?? []
        moreSets = try c.decodeIfPresent(Int.self, forKey: .moreSets) ?? 0
        rest = try c.decodeIfPresent(WatchPhoneRest.self, forKey: .rest)
    }
}

/// A routine on the start list, with what starting it lays out.
struct WatchRoutine: Decodable, Identifiable {
    let id: String
    let name: String
    let exerciseCount: Int
    let fromToday: Bool
    let taskId: String?
    let programId: String?
    let exercises: [WatchWorkoutExercise]
    let plan: [WatchWorkoutSet]

    enum CodingKeys: String, CodingKey { case id, name, exerciseCount, fromToday, taskId, programId, exercises, plan }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        exerciseCount = try c.decodeIfPresent(Int.self, forKey: .exerciseCount) ?? 0
        fromToday = try c.decodeIfPresent(Bool.self, forKey: .fromToday) ?? false
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        programId = try c.decodeIfPresent(String.self, forKey: .programId)
        exercises = try c.decodeIfPresent([WatchWorkoutExercise].self, forKey: .exercises) ?? []
        plan = try c.decodeIfPresent([WatchWorkoutSet].self, forKey: .plan) ?? []
    }
}

/// The quiet-hours window ("HH:MM"), which the watch's own rest alert keeps to
/// as the phone's rest does (`isWithinQuietHours` in notifications.ts).
struct WatchQuietHours: Codable, Equatable {
    let start: String
    let end: String

    private static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    func contains(_ date: Date) -> Bool {
        guard let startMin = Self.minutes(start), let endMin = Self.minutes(end), startMin != endMin else { return false }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let m = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        return startMin < endMin ? (m >= startMin && m < endMin) : (m >= startMin || m < endMin)
    }
}

struct WatchWorkoutSection: Decodable {
    let unit: String
    /// One click of the Crown on a weight, in `unit`.
    let weightStep: Double
    let live: WatchLiveWorkout?
    let routines: [WatchRoutine]
    let quietHours: WatchQuietHours?

    enum CodingKeys: String, CodingKey { case unit, weightStep, live, routines, quietHours }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? "kg"
        weightStep = try c.decodeIfPresent(Double.self, forKey: .weightStep) ?? 2.5
        live = try c.decodeIfPresent(WatchLiveWorkout.self, forKey: .live)
        routines = try c.decodeIfPresent([WatchRoutine].self, forKey: .routines) ?? []
        quietHours = try c.decodeIfPresent(WatchQuietHours.self, forKey: .quietHours)
    }
}

/// The one key the watch reads out of the snapshot for itself.
struct WatchWorkoutEnvelope: Decodable {
    let workout: WatchWorkoutSection?

    enum CodingKeys: String, CodingKey { case workout }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workout = try c.decodeIfPresent(WatchWorkoutSection.self, forKey: .workout)
    }
}

// ==== The watch's own workout ====

/// A rest as the watch shows it.
struct WatchRestSpan: Codable, Equatable {
    var startedAt: Date
    var endsAt: Date
    /// The phone's rest it is, when it is one; a +30 s or Skip names it.
    var phoneRestId: String?

    /// Whole seconds of its start: the phone's copy of a rest the watch
    /// started has the same start to the second, so "Go to the set" holds
    /// across the phone taking over the rest the watch was drawing.
    var key: Int { Int(startedAt.timeIntervalSince1970.rounded(.down)) }
}

struct WatchOwnWorkout: Codable {
    let id: String
    let routineId: String
    let programId: String?
    let taskId: String?
    let title: String
    let startedAt: Date
    let unit: String
    let weightStep: Double
    let exercises: [WatchWorkoutExercise]
    var sets: [WatchWorkoutSet]
    var rest: WatchRestSpan?
    let quietHours: WatchQuietHours?

    /// What Finish sends: the done sets, in the unit shown (the phone
    /// converts), as JSON text (`parseWatchSession` in widgetQuietTaps.ts).
    func payload(endedAt: Date) -> String? {
        let sets: [[String: Any]] = self.sets.compactMap { set in
            guard let doneAt = set.doneAt else { return nil }
            var entry: [String: Any] = [
                "id": set.id,
                "exerciseId": set.exerciseId,
                "position": set.position,
                "setIndex": set.setIndex,
                "kind": set.kind,
                "completedAt": doneAt,
            ]
            if let weight = set.weight { entry["weight"] = weight }
            if let reps = set.reps { entry["reps"] = reps }
            if let durationSeconds = set.durationSeconds { entry["durationSeconds"] = durationSeconds }
            if let distanceM = set.distanceM { entry["distanceM"] = distanceM }
            return entry
        }
        var body: [String: Any] = [
            "id": id,
            "routineId": routineId,
            "title": title,
            "startedAt": watchISO(startedAt),
            "endedAt": watchISO(endedAt),
            "unit": unit,
            "sets": sets,
        ]
        if let programId { body["programId"] = programId }
        if let taskId { body["taskId"] = taskId }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// The watch's own workout on disk, in the watch's App Group, under the same
/// path shape as the snapshot and the tap log.
enum WatchOwnWorkoutFile {
    static let fileName = "watch_workout.json"

    private static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(fileName)
    }

    static func load() -> WatchOwnWorkout? {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WatchOwnWorkout.self, from: data)
    }

    static func save(_ workout: WatchOwnWorkout?) {
        guard let url = fileURL() else { return }
        guard let workout, let data = try? JSONEncoder().encode(workout) else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}

/// What the finished screen says.
struct WatchFinishedSummary: Equatable {
    let title: String
    let elapsed: String
    let setsDone: Int
    /// The phone wasn't in reach when it was finished, so it says the workout
    /// reaches the phone later.
    let queued: Bool
}

/// ISO text with fractional seconds, which the app's own stamps carry too.
func watchISO(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

// ==== What a screen draws ====

enum WatchWorkoutSource {
    case phone, own
}

/// A workout as the screens draw it, whichever device is running it.
struct WatchWorkoutScreen {
    let source: WatchWorkoutSource
    let sessionId: String
    let title: String
    let startedAt: Date?
    let unit: String
    let weightStep: Double
    let exercises: [WatchWorkoutExercise]
    /// In the order they are done, with what was done here drawn in.
    let sets: [WatchWorkoutSet]
    let moreSets: Int
    /// The rest to show, already past the "is it about the last set" and
    /// "Go to the set" checks; nil shows the next set.
    let rest: WatchRestSpan?

    var nextSet: WatchWorkoutSet? { sets.first { !$0.isDone } }
    var setsDone: Int { sets.filter(\.isDone).count }

    func exercise(_ id: String) -> WatchWorkoutExercise? { exercises.first { $0.id == id } }

    /// A rest is shown only while it is about the newest set done: a rest
    /// older than that (left going by a superset partner) belongs to a set
    /// already moved past. And not once "Go to the set" has put it away.
    static func shownRest(_ rest: WatchRestSpan?, sets: [WatchWorkoutSet], dismissedKey: Int?) -> WatchRestSpan? {
        guard let rest else { return nil }
        if let latest = sets.compactMap(\.doneDate).max(), rest.startedAt < latest.addingTimeInterval(-1.5) { return nil }
        if dismissedKey == rest.key { return nil }
        return rest
    }
}

// ==== Actions ====

extension WatchStore {
    static let restNotificationId = "watch-workout-rest"
    /// What +30 s adds, the phone's REST_NUDGE_FORWARD_SECONDS.
    static let restNudgeSeconds: TimeInterval = 30

    /// Whether the Workout row belongs on Today: the area is on, or a workout
    /// is going here regardless (it must stay reachable).
    var workoutVisible: Bool { workoutSection != nil || ownWorkout != nil }

    /// The routines to start from, today's first.
    var startRoutines: [WatchRoutine] { workoutSection?.routines ?? [] }

    /// The workout the screens draw: this watch's own first (one started here
    /// carries on even if a workout is started on the phone meanwhile), else
    /// the phone's, unless it was finished here.
    var workoutScreen: WatchWorkoutScreen? {
        if let own = ownWorkout {
            return WatchWorkoutScreen(
                source: .own,
                sessionId: own.id,
                title: own.title,
                startedAt: own.startedAt,
                unit: own.unit,
                weightStep: own.weightStep,
                exercises: own.exercises,
                sets: own.sets,
                moreSets: 0,
                rest: WatchWorkoutScreen.shownRest(own.rest, sets: own.sets, dismissedKey: dismissedRestKey)
            )
        }
        guard let section = workoutSection, let live = section.live else { return nil }
        let local = self.local
        guard !local.finishedSessions.contains(live.sessionId) else { return nil }
        let sets = live.sets.map { set -> WatchWorkoutSet in
            guard !set.isDone, let done = local.doneSets[set.id] else { return set }
            return set.done(done.values, at: done.at)
        }
        return WatchWorkoutScreen(
            source: .phone,
            sessionId: live.sessionId,
            title: live.title,
            startedAt: isoDate(live.startedAt),
            unit: section.unit,
            weightStep: section.weightStep,
            exercises: live.exercises,
            sets: sets,
            moreSets: live.moreSets,
            rest: WatchWorkoutScreen.shownRest(phoneRest(live, local), sets: sets, dismissedKey: dismissedRestKey)
        )
    }

    /// The phone's rest as the snapshot has it, with the rest taps made here
    /// since laid over it in order: a set done here starts its own (from the
    /// moment it was done, as the phone will), +30 s moves the end, Skip ends it.
    private func phoneRest(_ live: WatchLiveWorkout, _ local: LocalTapState) -> WatchRestSpan? {
        var rest: WatchRestSpan? = live.rest.flatMap { r in
            guard let start = isoDate(r.startedAt), let end = isoDate(r.endsAt) else { return nil }
            return WatchRestSpan(startedAt: start, endsAt: end, phoneRestId: r.id)
        }
        for tap in local.workoutTaps where tap.sessionId == live.sessionId {
            switch tap.kind {
            case "set":
                guard let set = live.sets.first(where: { $0.id == tap.itemId }) else { continue }
                if set.rest > 0 {
                    rest = WatchRestSpan(startedAt: tap.at, endsAt: tap.at.addingTimeInterval(TimeInterval(set.rest)), phoneRestId: nil)
                } else if set.rest == 0 {
                    rest = nil
                }
            case "restAdd":
                if var r = rest {
                    r.endsAt = max(r.endsAt, tap.at).addingTimeInterval(Self.restNudgeSeconds)
                    rest = r
                }
            case "restSkip":
                rest = nil
            default:
                break
            }
        }
        return rest
    }

    private var phoneReachable: Bool {
        WCSession.isSupported() && WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    // ---- starting ----

    /// Starts `routine` on this watch, laid out from its plan with ids of the
    /// watch's own. Asks once for the notification that taps the wrist when a
    /// rest ends with the app closed; without it, only the in-app tap comes.
    func startOwnWorkout(_ routine: WatchRoutine) {
        guard ownWorkout == nil, let section = workoutSection, !routine.plan.isEmpty else { return }
        let sets = routine.plan.map { set -> WatchWorkoutSet in
            var copy = set
            copy.id = UUID().uuidString
            copy.doneAt = nil
            return copy
        }
        let workout = WatchOwnWorkout(
            id: UUID().uuidString,
            routineId: routine.id,
            programId: routine.programId,
            taskId: routine.taskId,
            title: routine.name,
            startedAt: Date(),
            unit: section.unit,
            weightStep: section.weightStep,
            exercises: routine.exercises,
            sets: sets,
            rest: nil,
            quietHours: section.quietHours
        )
        ownWorkout = workout
        dismissedRestKey = nil
        finishedSummary = nil
        WatchOwnWorkoutFile.save(workout)
        WKInterfaceDevice.current().play(.start)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    // ---- a set ----

    func doneSet(_ set: WatchWorkoutSet, values: WatchSetValues, in screen: WatchWorkoutScreen) {
        let now = Date()
        WKInterfaceDevice.current().play(.success)
        switch screen.source {
        case .own:
            guard var workout = ownWorkout, let index = workout.sets.firstIndex(where: { $0.id == set.id }),
                  !workout.sets[index].isDone else { return }
            workout.sets[index] = workout.sets[index].done(values, at: now)
            if set.rest > 0 {
                workout.rest = WatchRestSpan(startedAt: now, endsAt: now.addingTimeInterval(TimeInterval(set.rest)), phoneRestId: nil)
            } else if set.rest == 0 {
                workout.rest = nil
            }
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
            scheduleRestNotification(for: workout.rest, title: workout.title, quietHours: workout.quietHours)
        case .phone:
            guard !set.id.isEmpty, local.doneSets[set.id] == nil else { return }
            recordWorkoutTap(kind: "set", itemId: set.id, sessionId: screen.sessionId, values: values, unit: screen.unit)
            // The phone rings for its own rest, and its notification reaches
            // the wrist while it is locked. Out of reach it starts nothing
            // until the tap arrives, so the watch rings for it then.
            if !phoneReachable, set.rest > 0, let rest = workoutScreen?.rest {
                scheduleRestNotification(for: rest, title: screen.title, quietHours: workoutSection?.quietHours)
            } else if set.rest >= 0 {
                cancelRestNotification()
            }
        }
        refreshRestAlarm()
    }

    // ---- the rest ----

    func addRestTime(in screen: WatchWorkoutScreen) {
        let now = Date()
        switch screen.source {
        case .own:
            guard var workout = ownWorkout, var rest = workout.rest else { return }
            rest.endsAt = max(rest.endsAt, now).addingTimeInterval(Self.restNudgeSeconds)
            workout.rest = rest
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
            scheduleRestNotification(for: rest, title: workout.title, quietHours: workout.quietHours)
        case .phone:
            recordWorkoutTap(kind: "restAdd", itemId: screen.sessionId, sessionId: screen.sessionId, restId: screen.rest?.phoneRestId)
            if !phoneReachable, let rest = workoutScreen?.rest {
                scheduleRestNotification(for: rest, title: screen.title, quietHours: workoutSection?.quietHours)
            }
        }
        refreshRestAlarm()
    }

    func skipRest(in screen: WatchWorkoutScreen) {
        switch screen.source {
        case .own:
            guard var workout = ownWorkout else { return }
            workout.rest = nil
            ownWorkout = workout
            WatchOwnWorkoutFile.save(workout)
        case .phone:
            recordWorkoutTap(kind: "restSkip", itemId: screen.sessionId, sessionId: screen.sessionId, restId: screen.rest?.phoneRestId)
        }
        cancelRestNotification()
        refreshRestAlarm()
    }

    /// "Go to the set" on a rest that has run out. Nothing is sent: the rest
    /// waited, and the set is still the one it was.
    func goToSet(from screen: WatchWorkoutScreen) {
        dismissedRestKey = screen.rest?.key
        cancelRestNotification()
        refreshRestAlarm()
    }

    // ---- finishing ----

    func finishWorkout(_ screen: WatchWorkoutScreen) {
        let now = Date()
        let queued = !phoneReachable
        let elapsed = screen.startedAt.map { describeElapsed(since: $0, now: now) } ?? ""
        switch screen.source {
        case .own:
            guard let workout = ownWorkout else { return }
            let done = workout.sets.filter(\.isDone).count
            // A workout with nothing done records nothing, as finishing on the
            // phone drops every set never done; there is nothing to send.
            if done > 0, let body = workout.payload(endedAt: now) {
                recordWorkoutTap(kind: "watchSession", itemId: workout.id, title: workout.title, body: body)
                finishedSummary = WatchFinishedSummary(title: workout.title, elapsed: elapsed, setsDone: done, queued: queued)
            }
            ownWorkout = nil
            WatchOwnWorkoutFile.save(nil)
        case .phone:
            recordWorkoutTap(kind: "finish", itemId: screen.sessionId, sessionId: screen.sessionId)
            finishedSummary = WatchFinishedSummary(title: screen.title, elapsed: elapsed, setsDone: screen.setsDone, queued: queued)
        }
        dismissedRestKey = nil
        cancelRestNotification()
        refreshRestAlarm()
        WKInterfaceDevice.current().play(.success)
    }

    // ---- the wrist ----

    /// Taps the wrist when the rest on screen ends, while the app is in front
    /// (a notification does it otherwise). Rescheduled on every change; a
    /// late wake (the app was suspended through the end) stays silent.
    func refreshRestAlarm() {
        restAlarm?.cancel()
        restAlarm = nil
        guard let rest = workoutScreen?.rest else { return }
        let delay = rest.endsAt.timeIntervalSinceNow
        guard delay > 0 else { return }
        let key = rest.key
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.isActive, let now = self.workoutScreen?.rest,
                  now.key == key, abs(now.endsAt.timeIntervalSinceNow) < 2 else { return }
            WKInterfaceDevice.current().play(.notification)
        }
        restAlarm = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    /// The notification for the end of a rest the watch is keeping, outside
    /// quiet hours. One at a time, replaced on every change.
    func scheduleRestNotification(for rest: WatchRestSpan?, title: String, quietHours: WatchQuietHours?) {
        cancelRestNotification()
        guard let rest else { return }
        let interval = rest.endsAt.timeIntervalSinceNow
        // A time-interval trigger refuses anything not above zero.
        guard interval >= 1, quietHours?.contains(rest.endsAt) != true else { return }
        let content = UNMutableNotificationContent()
        content.title = "Rest is over"
        content.body = title.isEmpty ? "Time for your next set." : "\(title): time for your next set."
        content.sound = UNNotificationSound.default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        let request = UNNotificationRequest(identifier: Self.restNotificationId, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    func cancelRestNotification() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.restNotificationId])
    }
}
